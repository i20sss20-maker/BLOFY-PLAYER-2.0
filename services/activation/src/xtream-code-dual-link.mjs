// BLOFY STREAM: operator-only, bidirectional access to ONE existing subscription.
// Voucher -> BLOFY-issued Xtream credentials and Xtream account -> SAME voucher.
// No upstream provider credentials, no duplicate subscriptions, no renewal.
// Every call is protected by the existing gateway admin session at the route.
import crypto from 'node:crypto';
import {
  normalizeStreamCode,streamCodeProof,randomNumericStreamCode,
  streamNumericCodeLength
} from './xtream-duration-codes.mjs';
import {decryptStreamCode,encryptStreamCode} from './xtream-code-vault.mjs';
import {decryptGatewayAccountPassword} from './xtream-account-vault.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SALEH='d2bb0397-1c56-4751-adc9-1a17758022f6';
const err=(code,status=409)=>Object.assign(Error(code),{status});
const timestamp=value=>{
  if(!value)return null;
  const n=new Date(value).getTime();
  return Number.isFinite(n)?n:null;
};
function credentials(serverUrl,username,password){
  const base=new URL(serverUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||
     base.search||base.hash)throw err('stream_link_origin_invalid',503);
  const params=new URLSearchParams({username,password,type:'m3u_plus',output:'ts'});
  return {serverUrl:base.origin,username,password,
    m3uUrl:base.origin+'/get.php?'+params.toString()};
}
function accountCheck(row,now){
  if(!row||row.enabled!==true)throw err('stream_link_account_unavailable');
  const expiry=timestamp(row.expires_at);
  if(expiry===null)throw err('stream_link_account_expiry_required');
  if(expiry<=now)throw err('stream_link_account_expired');
  // An existing source bound to a different origin must not be converted,
  // changed to saleh, or silently broadened into all published sources.
  if(row.source_id&&String(row.source_id).toLowerCase()!==SALEH)
    throw err('stream_link_saleh_source_only');
  return expiry;
}
export function createStreamCodeXtreamLink({pool,keyHex,clock=Date.now,
  randomBytes=crypto.randomBytes,uuid=crypto.randomUUID}={}){
  if(!pool||!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))
    throw Error('stream_link_config_invalid');

  async function codeToXtream({code,serverUrl}={}){
    const proof=streamCodeProof(code,keyHex);
    if(!proof)throw err('stream_code_invalid',400);
    const result=await pool.query(`SELECT
        c.id AS voucher_id,c.redeemed_at,c.expires_at AS voucher_expiry,
        c.revoked_at,c.code_vault,c.code_channel,c.account_id,
        a.id,a.username,a.credential_vault,a.enabled,a.expires_at,a.source_id
      FROM blofy_xtream_gateway_duration_codes c
      LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=c.account_id
      WHERE c.code_hash=$1 LIMIT 1`,[proof]);
    const row=result.rows?.[0];
    if(!row)throw err('stream_link_code_not_found',404);
    if(row.revoked_at)throw err('stream_link_code_revoked');
    if(!row.redeemed_at||!row.account_id)
      throw err('stream_link_activate_first');
    const now=clock();
    const expiry=accountCheck(row,now);
    const voucherExpiry=timestamp(row.voucher_expiry);
    if(voucherExpiry===null||voucherExpiry<=now)
      throw err('stream_link_code_expired');
    const password=decryptGatewayAccountPassword(row.id,row.credential_vault,keyHex);
    if(!password)throw err('stream_link_credentials_unavailable');
    return {ok:true,linked:true,created:false,subscriptionUnchanged:true,
      accountId:row.id,codeId:row.voucher_id,expiresAt:Math.min(expiry,voucherExpiry),
      credentials:credentials(serverUrl,row.username,password)};
  }

  async function xtreamToCode({accountId}={}){
    if(!UUID.test(String(accountId||'')))throw err('stream_link_account_invalid',400);
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      // Lock the account to serialize simultaneous requests for the SAME
      // Xtream identity; the voucher table also has UNIQUE(account_id).
      const account=(await db.query(`SELECT id,label,enabled,max_connections,
          source_id,expires_at,created_at
        FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE`,[accountId])).rows?.[0];
      const now=clock();
      const expiry=accountCheck(account,now);
      const old=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE account_id=$1 FOR UPDATE`,[accountId])).rows?.[0];
      if(old){
        if(old.revoked_at||!old.redeemed_at)
          throw err('stream_link_code_unavailable');
        const voucherExpiry=timestamp(old.expires_at);
        if(voucherExpiry===null||voucherExpiry<=now)
          throw err('stream_link_code_expired');
        const code=old.code_vault?decryptStreamCode(old.id,old.code_vault,keyHex):null;
        if(!code||streamCodeProof(code,keyHex)!==old.code_hash)
          throw err('stream_link_legacy_code_not_recoverable');
        // The unchanged original code works in STREAM app as well as
        // Xtream after explicit admin linkage. Device binding remains in
        // redeem(), and existing Xtream credentials are never rotated.
        if(old.dual_access_enabled!==true)
          await db.query(`UPDATE blofy_xtream_gateway_duration_codes
            SET dual_access_enabled=TRUE WHERE id=$1`,[old.id]);
        await db.query('COMMIT');
        return {ok:true,linked:true,created:false,code,codeId:old.id,
          accountId:account.id,expiresAt:Math.min(expiry,voucherExpiry),
          subscriptionUnchanged:true,deviceBindingPreserved:true};
      }
      // Standalone Xtream account: create exactly ONE already-redeemed
      // application voucher. Start/expiry come from the existing account.
      // Never allocate a second gateway login or a new subscription clock.
      const days=Math.ceil((expiry-now)/86400000);
      if(!Number.isSafeInteger(days)||days<1||days>730)
        throw err('stream_link_duration_unsupported');
      await db.query('SELECT pg_advisory_xact_lock(718420682)');
      const countRow=(await db.query(
        'SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'
      )).rows?.[0];
      const digits=streamNumericCodeLength(Number(countRow?.count||0));
      let created=null;
      for(let tries=0;tries<16;tries++){
        const code=randomNumericStreamCode(digits,randomBytes);
        const id=uuid(),proof=streamCodeProof(code,keyHex);
        const row=(await db.query(`INSERT INTO blofy_xtream_gateway_duration_codes
          (id,code_hash,code_hint,label,source_id,duration_days,max_connections,
           code_channel,code_vault,dual_access_enabled,account_id,redeemed_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'app',$8,TRUE,$9,$10,$11)
          ON CONFLICT (code_hash) DO NOTHING RETURNING id`,[
          id,proof,code.slice(0,2)+'••••'+code.slice(-2),
          String(account.label||'BLOFY STREAM').slice(0,100),
          account.source_id,days,Math.max(1,Math.min(20,Number(account.max_connections)||1)),
          encryptStreamCode(id,code,keyHex),account.id,
          account.created_at&&timestamp(account.created_at)<=now?account.created_at:new Date(now),
          account.expires_at
        ])).rows?.[0];
        if(row){created={code,codeId:id};break;}
      }
      if(!created)throw err('stream_link_code_generation_unavailable',503);
      await db.query('COMMIT');
      return {ok:true,linked:true,created:true,code:created.code,
        codeId:created.codeId,accountId:account.id,expiresAt:expiry,
        subscriptionUnchanged:true,deviceBindingPreserved:true};
    }catch(error){
      await db.query('ROLLBACK').catch(()=>{});
      // Another worker can only race through account lock/unique linkage.
      if(error?.code==='23505')throw err('stream_link_code_already_exists');
      throw error;
    }finally{db.release()}
  }
  return {codeToXtream,xtreamToCode};
}
