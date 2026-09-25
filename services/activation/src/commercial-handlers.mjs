import crypto from 'node:crypto';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';
import { createActivationCredentialCodec } from './auth-protection.mjs';
import { createGooglePlayReviewHandler } from './google-play-review.mjs';
import { createSubscriberSessionAuthorizer } from './subscriber-session-auth.mjs';

export class CommercialError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const millis = value => value == null ? null : new Date(value).getTime();
const entitled = row => row && ['active','trial'].includes(row.status) &&
  (row.expires_at == null || millis(row.expires_at) > Date.now());
const validDeviceId = value => /^BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(String(value || ''));
const validActivationCode = value => /^\d{6}$/.test(String(value || ''));

export function createCommercialHandlers({pool, keyHex, json, readJson, env = process.env}) {
  const auth = createSubscriberSessionAuthorizer({pool, keyHex, env, requireActive:false});
  const credentials = createActivationCredentialCodec(keyHex);
  const googlePlayReview = createGooglePlayReviewHandler({pool,keyHex,json,readJson});
  const hash = value => crypto.createHmac('sha256', Buffer.from(keyHex,'hex')).update('blofy-recovery-v1:' + value).digest('hex');
  async function authorize(req, res, body) {
    const deviceId = String(body.deviceId || '').trim();
    const result = await auth(req, deviceId, String(body.activationCode || '').trim());
    if (!result.allowed) {
      json(res,result.status,{error:result.error},result.retryAfterSeconds ? {'retry-after':String(result.retryAfterSeconds)} : {});
      return null;
    }
    return deviceId;
  }
  async function transaction(action) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
  }
  async function issueKey(deviceId) {
    return transaction(async client => {
      const row = (await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      if (!entitled(row) || row.status !== 'active') throw new CommercialError('paid_license_required',409);
      const recoveryCode = crypto.randomBytes(24).toString('base64url');
      await client.query('DELETE FROM license_recovery_keys WHERE device_id=$1',[deviceId]);
      await client.query('INSERT INTO license_recovery_keys(key_hash,device_id) VALUES($1,$2)',[hash(recoveryCode),deviceId]);
      return {recoveryCode,expiresAt:millis(row.expires_at)};
    });
  }
  async function restoreKey(deviceId, code) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(String(code || ''))) throw new CommercialError('invalid_recovery_code');
    return transaction(async client => {
      // Read the owner first, then lock both device rows in a stable order. Issuing, deleting,
      // restoring and replays all serialize without permitting two active copies of a license.
      const keyHash = hash(code);
      const existing = (await client.query('SELECT device_id FROM license_recovery_keys WHERE key_hash=$1',[keyHash])).rows[0];
      if (!existing) throw new CommercialError('recovery_unavailable',404);
      const rows = (await client.query('SELECT * FROM devices WHERE device_id=ANY($1::text[]) ORDER BY device_id FOR UPDATE',
        [[deviceId,existing.device_id]])).rows;
      const source = rows.find(row=>row.device_id===existing.device_id), target = rows.find(row=>row.device_id===deviceId);
      const key = (await client.query('SELECT * FROM license_recovery_keys WHERE key_hash=$1 FOR UPDATE',[keyHash])).rows[0];
      if (!key || !source || !target || target.status==='blocked') throw new CommercialError('recovery_unavailable',409);
      if (key.consumed_at) {
        if (key.target_device_id===deviceId && target.status==='active' && entitled(target)) {
          return {restored:true,replayed:true,expiresAt:millis(target.expires_at)};
        }
        throw new CommercialError('recovery_code_used',409);
      }
      if (source.device_id===deviceId) throw new CommercialError('same_device_recovery',409);
      if (!entitled(source) || source.status!=='active') throw new CommercialError('recovery_unavailable',409);
      if (target.status==='active' && entitled(target)) throw new CommercialError('target_already_licensed',409);
      await client.query("UPDATE devices SET status='active',expires_at=$2,session_version=session_version+1,updated_at=NOW() WHERE device_id=$1",[deviceId,source.expires_at]);
      await client.query("UPDATE devices SET status='blocked',updated_at=NOW() WHERE device_id=$1",[source.device_id]);
      await client.query('UPDATE license_recovery_keys SET consumed_at=NOW(),target_device_id=$2 WHERE key_hash=$1',[keyHash,deviceId]);
      // Provider lists, passwords, profile data and other customers' data are never imported.
      return {restored:true,expiresAt:millis(source.expires_at)};
    });
  }
  async function migrateIdentity(sourceDeviceId, targetDeviceId, targetActivationCode) {
    if (!validDeviceId(targetDeviceId) || !validActivationCode(targetActivationCode)) {
      throw new CommercialError('invalid_target_identity');
    }
    if (sourceDeviceId === targetDeviceId) return {migrated:false,alreadyStable:true,deviceId:sourceDeviceId};
    return transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['blofy-device-identity:'+sourceDeviceId]);
      await client.query(ADMIN_CONSOLE_SCHEMA);
      const rows = (await client.query(
        'SELECT * FROM devices WHERE device_id=ANY($1::text[]) ORDER BY device_id FOR UPDATE',
        [[sourceDeviceId,targetDeviceId]]
      )).rows;
      const source = rows.find(row => row.device_id === sourceDeviceId);
      const target = rows.find(row => row.device_id === targetDeviceId);
      if (!source) throw new CommercialError('source_device_missing',404);
      if (source.status === 'blocked') throw new CommercialError('source_device_blocked',409);

      const targetProof = credentials.proof(targetDeviceId,targetActivationCode);
      if (target) {
        if (target.status === 'blocked' || !credentials.matches(target,targetActivationCode)) {
          throw new CommercialError('target_device_conflict',409);
        }
        // The caller has authenticated both identities. Merge a previously-created stable
        // placeholder instead of stranding the paid/trial entitlement on the legacy ID.
        const preserveTargetPaid = target.status === 'active' && entitled(target);
        await client.query(`UPDATE devices SET
          status=$2,
          trial_started_at=$3,
          expires_at=$4,
          created_at=LEAST(created_at,$5),
          updated_at=NOW(),
          session_version=GREATEST(session_version,$6)+1,
          data_deleted_at=$7,
          trial_registration_pending=$8
          WHERE device_id=$1`,[
            targetDeviceId,
            preserveTargetPaid ? target.status : source.status,
            preserveTargetPaid ? target.trial_started_at : source.trial_started_at,
            preserveTargetPaid ? target.expires_at : source.expires_at,
            source.created_at,
            Number(source.session_version || 0),
            source.data_deleted_at,
            source.trial_registration_pending
          ]);

        if ((await client.query("SELECT to_regclass('device_playlists') AS name")).rows[0]?.name) {
          await client.query('UPDATE device_playlists SET active=FALSE WHERE device_id=$1',[targetDeviceId]);
        }
        if ((await client.query("SELECT to_regclass('profile_cloud_snapshots') AS name")).rows[0]?.name) {
          await client.query(`DELETE FROM profile_cloud_snapshots t USING profile_cloud_snapshots s
            WHERE t.device_id=$2 AND s.device_id=$1 AND t.profile_id=s.profile_id`,[sourceDeviceId,targetDeviceId]);
        }
        for (const table of ['device_customers','license_recovery_keys','device_admin_metadata']) {
          if ((await client.query('SELECT to_regclass($1) AS name',[table])).rows[0]?.name) {
            await client.query(`DELETE FROM ${table} WHERE device_id=$1`,[targetDeviceId]);
          }
        }
      } else {
        await client.query(`INSERT INTO devices(
          device_id,activation_code,status,trial_started_at,expires_at,created_at,updated_at,last_seen_at,
          last_app_version,last_platform,auth_failed_attempts,last_auth_failure_at,auth_locked_until,
          previous_activation_code_proof,activation_rotated_at,session_version,data_deleted_at,trial_registration_pending
        ) SELECT $2,$3,status,trial_started_at,expires_at,created_at,NOW(),last_seen_at,
          last_app_version,last_platform,0,NULL,NULL,NULL,NULL,session_version+1,data_deleted_at,trial_registration_pending
          FROM devices WHERE device_id=$1`,[sourceDeviceId,targetDeviceId,targetProof]);
      }

      const directTables = [
        'device_playlists','playback_diagnostics','license_recovery_keys','profile_cloud_snapshots',
        'device_customers','support_tickets','subscription_orders','device_subscriptions','device_audit',
        'device_admin_metadata'
      ];
      for (const table of directTables) {
        if ((await client.query('SELECT to_regclass($1) AS name',[table])).rows[0]?.name) {
          await client.query(`UPDATE ${table} SET device_id=$2 WHERE device_id=$1`,[sourceDeviceId,targetDeviceId]);
        }
      }
      if ((await client.query("SELECT to_regclass('cloud_pair_codes') AS name")).rows[0]?.name) {
        await client.query('UPDATE cloud_pair_codes SET source_device_id=$2 WHERE source_device_id=$1',[sourceDeviceId,targetDeviceId]);
      }
      if ((await client.query("SELECT to_regclass('device_trial_claims') AS name")).rows[0]?.name) {
        await client.query('UPDATE device_trial_claims SET first_device_id=$2 WHERE first_device_id=$1',[sourceDeviceId,targetDeviceId]);
      }
      await client.query('DELETE FROM devices WHERE device_id=$1',[sourceDeviceId]);
      return {migrated:true,deviceId:targetDeviceId};
    });
  }
  async function deleteData(deviceId, confirmation) {
    if (confirmation !== 'DELETE') throw new CommercialError('confirmation_required');
    return transaction(async client => {
      await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE',[deviceId]);
      const tables = ['device_playlists','playback_diagnostics','profile_cloud_snapshots','license_recovery_keys',
        'device_customers','support_tickets','device_admin_metadata','device_audit'];
      for (const table of tables) {
        if ((await client.query('SELECT to_regclass($1) AS name',[table])).rows[0]?.name) {
          await client.query(`DELETE FROM ${table} WHERE device_id=$1`,[deviceId]);
        }
      }
      await client.query('DELETE FROM cloud_pair_codes WHERE source_device_id=$1',[deviceId]);
      await client.query("UPDATE device_trial_claims SET first_device_id='deleted' WHERE first_device_id=$1",[deviceId]);
      // A credential-free tombstone prevents old tokens from becoming valid if the ID is reused.
      // Keep only this anti-abuse ID plus separately recorded financial transactions, not profiles.
      await client.query(`UPDATE devices SET status='blocked',activation_code=$2,previous_activation_code_proof=NULL,
        activation_rotated_at=NULL,auth_failed_attempts=0,last_auth_failure_at=NULL,auth_locked_until=NULL,
        trial_started_at=NULL,expires_at=NULL,last_seen_at=NULL,last_app_version=NULL,last_platform=NULL,
        data_deleted_at=NOW(),updated_at=NOW() WHERE device_id=$1`,[deviceId,'deleted:'+crypto.randomBytes(32).toString('hex')]);
      return {deleted:true,licenseRevoked:true};
    });
  }
  return async function handle(req,res,url) {
    const path=url.pathname;
    if (await googlePlayReview(req,res,url)) return true;
    if (req.method==='GET' && path==='/api/v1/subscriptions/plans') {
      // No prices or purchase flow are advertised until a real billing integration is configured.
      json(res,200,{items:[],purchasesAvailable:false}); return true;
    }
    const routes=['/api/v1/subscriptions/status','/api/v1/license/recovery/create','/api/v1/license/recovery/restore',
      '/api/v1/device/sessions/revoke','/api/v1/device/identity/migrate','/api/v1/privacy/delete','/api/v1/privacy/support'];
    if (!routes.includes(path)) return false;
    if (req.method!=='POST') {json(res,405,{error:'method_not_allowed'});return true;}
    try {
      const body=await readJson(req),deviceId=await authorize(req,res,body);
      if (!deviceId) return true;
      if (path==='/api/v1/subscriptions/status') {
        const row=(await pool.query('SELECT status,expires_at,trial_started_at FROM devices WHERE device_id=$1',[deviceId])).rows[0];
        json(res,200,{active:entitled(row),planKey:row?.status==='trial'?'trial':row?.status==='active'?'license':null,
          planName:row?.status==='trial'?'تجربة BLOFY':row?.status==='active'?'BLOFY PLAYER':null,maxDevices:1,
          startsAt:millis(row?.trial_started_at),expiresAt:millis(row?.expires_at),purchasesAvailable:false});
      } else if (path.endsWith('/privacy/support')) {
        const message=String(body.message||'').trim();
        if (message.length<3 || message.length>2000) throw new CommercialError('invalid_message');
        await transaction(async client=>{
          await client.query('SELECT pg_advisory_xact_lock(718420641)');
          await client.query(ADMIN_CONSOLE_SCHEMA);
          await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE',[deviceId]);
          const recent=await client.query("SELECT 1 FROM support_tickets WHERE device_id=$1 AND created_at>NOW()-INTERVAL '5 minutes'",[deviceId]);
          if(recent.rows.length)throw new CommercialError('rate_limited',429);
          await client.query('INSERT INTO support_tickets(id,device_id,description) VALUES($1,$2,$3)',[crypto.randomUUID(),deviceId,'استفسار خصوصية: '+message]);
        });
        json(res,201,{received:true});
      } else if (path.endsWith('/recovery/create')) json(res,201,await issueKey(deviceId));
      else if (path.endsWith('/recovery/restore')) json(res,200,await restoreKey(deviceId,body.recoveryCode));
      else if (path.endsWith('/identity/migrate')) json(res,200,await migrateIdentity(
        deviceId,String(body.targetDeviceId||'').trim(),String(body.targetActivationCode||'').trim()
      ));
      else if (path.endsWith('/sessions/revoke')) {
        await pool.query('UPDATE devices SET session_version=session_version+1,updated_at=NOW() WHERE device_id=$1',[deviceId]);
        json(res,200,{revoked:true});
      } else json(res,200,await deleteData(deviceId,body.confirmation));
      return true;
    } catch(error) {if (error instanceof CommercialError) {json(res,error.status,{error:error.message});return true;} throw error;}
  };
}
