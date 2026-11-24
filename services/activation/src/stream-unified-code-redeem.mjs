import {normalizeStreamCode} from './xtream-duration-codes.mjs';

const error=(code,status)=>Object.assign(new Error(code),{status});
export function normalizeUnifiedCode(value){
 if(typeof value!=='string'||value.length>64)return null;
 const raw=value.trim();
 if(/^BC-[A-Za-z0-9_-]{24}$/.test(raw))return raw;
 return normalizeStreamCode(raw);
}

// Private dispatch only. Never expose a public code-classification endpoint or
// try the other redemption path after a failure. The caller owns rate limits.
export function createUnifiedCodeRedeemer({paidExists,connectExists,redeemPaid,redeemConnect}={}){
 return async function redeem({code,deviceKey,origin}={}){
  const normalized=normalizeUnifiedCode(code);
  if(!normalized||typeof deviceKey!=='string'||!/^[a-f0-9]{64}$/.test(deviceKey))
   throw error('stream_code_invalid',400);
  const paidEligible=!normalized.startsWith('BC-');
  const connectEligible=/^(?:[0-9]{8}|[0-9]{12}|BC-[A-Za-z0-9_-]{24})$/.test(normalized);
  // Both lookups must succeed before any consumption. Existing paid vouchers
  // include expired and revoked records; never interpret those as Connect.
  const paid=paidEligible?await paidExists(normalized):false;
  const external=connectEligible?await connectExists(normalized):false;
  if(paid&&external)throw error('stream_code_unavailable',409);
  if(!paid&&!external)throw error('stream_code_unavailable',409);
  if(paid){
   const result=await redeemPaid(normalized,origin,deviceKey);
   if(result?.ok!==true)throw error('stream_code_unavailable',409);
   return {...result,type:'blofy_stream'};
  }
  const result=await redeemConnect(normalized,deviceKey);
  if(result?.ok!==true||result.type!=='external_xtream')throw error('stream_code_unavailable',409);
  return result;
 };
}

// Shared database-backed adapter used by the HTTP gateway and isolated
// PostgreSQL integration tests. Each invocation owns its claim capability.
export function createDatabaseUnifiedRedeemer({pool,paidProof,pairing,redeemPaid}){
 return async input=>{
  let attempt=null;
  const redeem=createUnifiedCodeRedeemer({
   paidExists:async code=>{
    const proof=paidProof(code);
    if(!proof)return false;
    const result=await pool.query('SELECT 1 FROM blofy_xtream_gateway_duration_codes WHERE code_hash=$1 LIMIT 1',[proof]);
    return result.rows.length===1;
   },
   connectExists:async code=>{attempt=await pairing.beginUnifiedAttempt(code);return attempt.exists;},
   redeemPaid,
   redeemConnect:(_code,deviceKey)=>attempt.redeem(deviceKey)
  });
  return redeem(input);
 };
}
