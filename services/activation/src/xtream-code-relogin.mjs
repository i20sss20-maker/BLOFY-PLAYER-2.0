// BLOFY STREAM: same-voucher recovery for a replaced Android installation.
// A different installation is NEVER silently permitted to reuse a bound code.
// Only a verified admin may approve a one-time, *device-specific* request.
// No raw voucher, device key or recovery PIN is stored or logged.
import crypto from 'node:crypto';
import {streamCodeProof} from './xtream-duration-codes.mjs';

const CODE_KEY=/^[a-f0-9]{64}$/i;
const DEVICE_KEY=/^[a-f0-9]{64}$/i;
const SIX_DIGITS=/^[0-9]{6}$/;
const REQUEST_WINDOW=20*60*1000;
const APPROVAL_WINDOW=10*60*1000;

const problem=(message,status=409)=>Object.assign(Error(message),{status});
const asMs=value=>value?new Date(value).getTime():0;
const hmac=(key,description)=>crypto.createHmac('sha256',key).update(description).digest('hex');

export function streamDeviceProof(deviceKey,keyHex) {
  if(!DEVICE_KEY.test(String(deviceKey||''))||!CODE_KEY.test(String(keyHex||'')))
    return null;
  return hmac(Buffer.from(keyHex,'hex'),
    'blofy-stream-activation-device:v1:'+String(deviceKey).toLowerCase());
}
export function recoveryCodeProof(rowId,deviceProof,pin,keyHex) {
  if(!SIX_DIGITS.test(String(pin||''))||!CODE_KEY.test(String(keyHex||''))||
     !CODE_KEY.test(String(deviceProof||'')))
    return null;
  return hmac(Buffer.from(keyHex,'hex'),
    'blofy-stream-relogin-approval:v1:'+rowId+':'+deviceProof+':'+pin);
}
export function hasApprovedRelogin(row,deviceProof,now=Date.now()) {
  return Boolean(row && deviceProof &&
    row.code_channel==='app' &&
    row.relogin_device_hash===deviceProof &&
    row.relogin_request_hash &&
    asMs(row.relogin_approved_at)>0 &&
    asMs(row.relogin_expires_at)>now);
}
export function createStreamRelogin({pool,keyHex,clock=Date.now,
  randomInt=crypto.randomInt,uuid=crypto.randomUUID}={}) {
  if(!pool||!CODE_KEY.test(String(keyHex||'')))
    throw Error('stream_code_relogin_config_invalid');
  const run=async(task)=>{
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const result=await task(db);
      await db.query('COMMIT');
      return result;
    }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
    finally{db.release()}
  };
  const lookup=async(db,code)=>{
    const proof=streamCodeProof(code,keyHex);
    if(!proof)throw problem('stream_code_invalid',400);
    const row=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
      WHERE code_hash=$1 FOR UPDATE`,[proof])).rows?.[0];
    const now=clock();
    if(!row||row.code_channel!=='app'||!row.redeemed_at||!row.account_id||
       row.revoked_at||asMs(row.expires_at)<=now)
      throw problem('stream_code_relogin_unavailable',409);
    const account=(await db.query(`SELECT enabled,expires_at
       FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE`,[row.account_id])).rows?.[0];
    if(!account?.enabled||asMs(account.expires_at)<=now)
      throw problem('stream_code_relogin_unavailable',409);
    return {row,now};
  };
  async function request({code,deviceKey}={}) {
    const deviceHash=streamDeviceProof(deviceKey,keyHex);
    if(!deviceHash)throw problem('stream_code_device_invalid',400);
    return run(async(db)=>{
      const {row,now}=await lookup(db,code);
      if(row.redeemed_device_hash===deviceHash)
        return {ok:true,alreadyAuthorized:true};
      if(!row.redeemed_device_hash)
        throw problem('stream_code_relogin_unavailable',409);
      // No attacker with a leaked voucher may replace a different pending
      // request; admin must see the exact 6-digit approval code on the TV.
      if(asMs(row.relogin_expires_at)>now)
        throw problem('stream_code_relogin_already_pending',409);
      if(asMs(row.relogin_requested_at)>now-60_000)
        throw problem('stream_code_relogin_cooldown',429);
      const pin=String(randomInt(0,1_000_000)).padStart(6,'0');
      const challenge=recoveryCodeProof(row.id,deviceHash,pin,keyHex);
      const expiresAt=new Date(now+REQUEST_WINDOW);
      await db.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET relogin_device_hash=$2,relogin_request_hash=$3,
          relogin_requested_at=$4,relogin_approved_at=NULL,relogin_expires_at=$5
        WHERE id=$1`,[row.id,deviceHash,challenge,new Date(now),expiresAt]);
      return {ok:true,requestCode:pin,expiresAt:expiresAt.getTime(),
        message:'send_request_code_to_blofy_support'};
    });
  }
  async function approve({code,requestCode}={}) {
    if(!SIX_DIGITS.test(String(requestCode||'')))
      throw problem('stream_code_relogin_pin_invalid',400);
    return run(async(db)=>{
      const {row,now}=await lookup(db,code);
      if(!row.relogin_device_hash||!row.relogin_request_hash||
         asMs(row.relogin_expires_at)<=now||row.relogin_approved_at)
        throw problem('stream_code_relogin_request_unavailable',409);
      const expected=recoveryCodeProof(row.id,row.relogin_device_hash,requestCode,keyHex);
      const given=Buffer.from(String(row.relogin_request_hash),'hex');
      const known=Buffer.from(String(expected||''),'hex');
      if(given.length!==32||known.length!==32||!crypto.timingSafeEqual(given,known))
        throw problem('stream_code_relogin_pin_incorrect',403);
      const deadline=new Date(now+APPROVAL_WINDOW);
      await db.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET relogin_approved_at=$2,relogin_expires_at=$3
        WHERE id=$1 AND relogin_request_hash=$4`,
        [row.id,new Date(now),deadline,row.relogin_request_hash]);
      await db.query(`INSERT INTO blofy_xtream_gateway_code_events
        (id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)`,
        [uuid(),row.id,'same_voucher_device_relogin_approved',
          JSON.stringify({expiryPreserved:true,singleDevice:true})]);
      return {ok:true,codeId:row.id,
        expiresAt:deadline.getTime(),expiresUnchanged:true,
        instruction:'customer_enters_original_voucher_again'};
    });
  }
  return {request,approve};
}
