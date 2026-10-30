import crypto from 'node:crypto';

/**
 * Device reset/uninstall destroys local Android state. The user must explicitly
 * prove ownership of an existing license, using either an old one-time backup
 * code or an administrator-verified recovery. We never infer physical-device
 * identity from a resettable hardware identifier.
 */
export function createLicenseRecoveryHandlers({
  pool, json, readJson, requireAdmin, authorizedDevice,
  verifyDeviceCredential, activationCredentials, consumeDeviceAuthAttempt, keyHex
}) {
  const recoveryKey = Buffer.from(keyHex, 'hex');
  if (recoveryKey.length !== 32) throw new Error('license_recovery_key_missing');
  const validIdentity = (id,code) =>
    /^BLOFY-[A-Z0-9-]{4,32}$/i.test(id) && /^\d{6}$/.test(code);
  const validDeviceId = id => /^BLOFY-[A-Z0-9-]{4,32}$/i.test(id);
  const expiry = row => row.expires_at ? new Date(row.expires_at).getTime() : null;
  const hash = code => crypto.createHmac('sha256', recoveryKey)
    .update('blofy-license-recovery-v1:' + code).digest('hex');
  const error = (res,status,code) => json(res,status,{error:code});

  async function issue(req,res) {
    const body = await readJson(req);
    const id = String(body.deviceId || '').trim();
    const pin = String(body.activationCode || '').trim();
    if (!validIdentity(id,pin)) return error(res,400,'invalid_device_identity');
    const device = await authorizedDevice(id,pin,req,false);
    if (!device) return error(res,403,'unauthorized_device');
    // Trial and expired accounts can also preserve their *original* expiry.
    // Recovery must never extend a trial or convert it into a paid license.
    if (device.status === 'blocked' || !['active','trial','expired'].includes(device.status))
      return error(res,403,'recovery_unavailable');

    const code = crypto.randomBytes(24).toString('base64url'); // 32 chars; shown once
    const digest = hash(code);
    const result = await pool.query(
      `INSERT INTO license_recovery_codes(device_id,code_hash,expires_at)
       VALUES($1,$2,NOW()+INTERVAL '2 years')
       ON CONFLICT(device_id) DO UPDATE SET code_hash=$2,created_at=NOW(),
         expires_at=NOW()+INTERVAL '2 years',used_at=NULL RETURNING expires_at`,
      [id,digest]
    );
    return json(res,200,{recoveryCode:code,expiresAt:new Date(result.rows[0].expires_at).getTime()});
  }

  async function transfer(sourceId,targetId,targetPin,kind,expectedCodeHash) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock both identities in a deterministic order before reading/deleting.
      for (const id of [...new Set([sourceId,targetId])].sort()) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ 'blofy-device:'+id.toUpperCase() ]);
      }
      const originalResult = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE',[sourceId]);
      const old = originalResult.rows[0];
      if (!old || !['active','trial','expired'].includes(old.status)) {
        await client.query('ROLLBACK'); return {status:404,error:'recovery_unavailable'};
      }
      // Re-check and lock the token inside the same transaction. Concurrent
      // restore requests cannot spend the same one-time code twice.
      if (kind === 'self-service') {
        const token = await client.query(
          'SELECT code_hash FROM license_recovery_codes WHERE device_id=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',
          [sourceId]
        );
        if (token.rows[0]?.code_hash !== expectedCodeHash) {
          await client.query('ROLLBACK'); return {status:403,error:'recovery_code_used'};
        }
      }
      // This is license reattachment, not a new trial. Original dates/status
      // and every subscription/order/playlist row remain untouched.
      const targetResult = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE',[targetId]);
      const fresh = targetResult.rows[0];
      if (!fresh || fresh.status !== 'trial') {
        await client.query('ROLLBACK'); return {status:409,error:'target_already_licensed'};
      }
      if (!await verifyDeviceCredential(client,fresh,targetPin)) {
        await client.query('COMMIT'); return {status:403,error:'unauthorized_device'};
      }
      const alias = await client.query(
        'SELECT canonical_device_id FROM device_identity_aliases WHERE alias_device_id=$1 FOR UPDATE',
        [targetId]
      );
      if (alias.rows.length) {
        await client.query('ROLLBACK'); return {status:409,error:'target_identity_claimed'};
      }
      const linked = await client.query(
        `SELECT
          (SELECT COUNT(*)::int FROM device_playlists WHERE device_id=$1) AS playlists,
          (SELECT COUNT(*)::int FROM device_subscriptions WHERE device_id=$1) AS subscriptions,
          (SELECT COUNT(*)::int FROM subscription_orders WHERE device_id=$1) AS orders,
          (SELECT COUNT(*)::int FROM device_customers WHERE device_id=$1) AS customers`,
        [targetId]
      );
      if (Object.values(linked.rows[0]).some(n => Number(n)>0)) {
        await client.query('ROLLBACK'); return {status:409,error:'target_contains_customer_data'};
      }
      // A previous reinstall alias must be revoked as well; otherwise a stale
      // alias credential could rotate the recovered canonical account back.
      await client.query('DELETE FROM device_identity_aliases WHERE canonical_device_id=$1',[sourceId]);
      // Temporary trial row may have existed since first login after reset.
      // Only delete it if it has no independent customer/paid/playlist records.
      await client.query('DELETE FROM devices WHERE device_id=$1',[targetId]);
      await client.query(
        `INSERT INTO device_identity_aliases(alias_device_id,canonical_device_id,alias_activation_code_proof)
         VALUES($1,$2,$3)`,
        [targetId,sourceId,activationCredentials.proof(targetId,targetPin)]
      );
      // Invalidate the old installation credential immediately. Alias is the
      // only route to new secret; next check resolves back to original BLOFY ID.
      await client.query(
        `UPDATE devices
         SET activation_code=$2,previous_activation_code_proof=NULL,
           activation_rotated_at=NOW(),auth_failed_attempts=0,
           last_auth_failure_at=NULL,auth_locked_until=NULL,updated_at=NOW()
         WHERE device_id=$1`,
        [sourceId,activationCredentials.proof(sourceId,targetPin)]
      );
      // An admin-assisted recovery also invalidates previously issued self-service
      // tokens; otherwise a stolen old code could claim the subscription again.
      await client.query(
        'UPDATE license_recovery_codes SET used_at=NOW() WHERE device_id=$1',[sourceId]
      );
      await client.query(
        `INSERT INTO device_audit(device_id,actor,action,details)
         VALUES($1,$2,'factory_reset_license_restored',
           jsonb_build_object('newDeviceId',$3::text,'preservedExpiry',true))`,
        [sourceId,kind === 'admin' ? 'admin' : 'device',targetId]
      );
      await client.query('COMMIT');
      return {status:200,canonicalDeviceId:sourceId,restored:true};
    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally { client.release(); }
  }

  async function restore(req,res,isAdmin) {
    if (isAdmin && !requireAdmin(req,res)) return;
    const body = await readJson(req);
    const targetId = String(body.deviceId || body.targetDeviceId || '').trim();
    const targetPin = String(body.activationCode || body.targetActivationCode || '').trim();
    if (!validIdentity(targetId,targetPin)) return error(res,400,'invalid_device_identity');
    if (!isAdmin) consumeDeviceAuthAttempt(req,targetId);

    let sourceId;
    let expectedCodeHash = null;
    if (isAdmin) {
      if (body.confirmedOwnership !== true || String(body.reason||'').trim().length < 12)
        return error(res,400,'ownership_verification_required');
      sourceId = String(body.originalDeviceId||'').trim();
      if (!validDeviceId(sourceId)) return error(res,400,'invalid_device_identity');
    } else {
      const code = String(body.recoveryCode||'').trim();
      if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return error(res,400,'invalid_recovery_code');
      expectedCodeHash = hash(code);
      const matched = await pool.query(
        `SELECT device_id FROM license_recovery_codes
         WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW()`,
        [expectedCodeHash]
      );
      sourceId = matched.rows[0]?.device_id;
      if (!sourceId) return error(res,403,'invalid_recovery_code');
    }
    if (sourceId===targetId) return error(res,409,'same_device_recovery');

    const result = await transfer(sourceId,targetId,targetPin,isAdmin?'admin':'self-service',expectedCodeHash);
    return result.error ? error(res,result.status,result.error) : json(res,200,result);
  }
  return {
    handle: async (req,res,path) => {
      if (path === '/api/v1/license/recovery/create' && req.method === 'POST') { await issue(req,res); return true; }
      if (path === '/api/v1/license/recovery/restore' && req.method === 'POST') { await restore(req,res,false); return true; }
      if (path === '/api/v1/admin/device/recovery/restore' && req.method === 'POST') { await restore(req,res,true); return true; }
      return false;
    }
  };
}
