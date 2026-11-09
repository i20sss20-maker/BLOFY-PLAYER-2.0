// BLOFY STREAM app-only capability. This is not a Xtream username or
// password. The account's server-side credential stays behind the gateway.
import crypto from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
function key(keyHex){
  if(!/^[a-fA-F0-9]{64}$/.test(String(keyHex||'')))throw Error('stream_app_token_key_invalid');
  return Buffer.from(keyHex,'hex');
}
function context(row){
  if(!UUID.test(String(row?.account_id||''))||
     !/^[a-f0-9]{64}$/.test(String(row?.code_hash||''))||
     !/^[a-f0-9]{64}$/.test(String(row?.redeemed_device_hash||'')))
    throw Error('stream_app_token_data_invalid');
  return ['blofy-stream-app-token-v1',row.account_id,row.code_hash,row.redeemed_device_hash].join(':');
}
export function createStreamAppToken(row,keyHex){
  const mac=crypto.createHmac('sha256',key(keyHex)).update(context(row)).digest('base64url');
  return 'v1.'+row.account_id+'.'+mac;
}
export function parseStreamAppToken(value){
  if(typeof value!=='string'||value.length>130)return null;
  const match=TOKEN.exec(value);
  if(!match||!UUID.test(match[1]))return null;
  return {accountId:match[1],token:value};
}
export function verifyStreamAppToken(value,row,keyHex){
  const parsed=parseStreamAppToken(value);
  if(!parsed||!row||parsed.accountId!==row.account_id)return false;
  try {
    const expected=createStreamAppToken(row,keyHex);
    const a=Buffer.from(parsed.token,'utf8'),b=Buffer.from(expected,'utf8');
    return a.length===b.length&&crypto.timingSafeEqual(a,b);
  } catch {return false}
}
export function bearerFromRequest(req){
  const header=String(req?.headers?.authorization||'');
  const match=/^Bearer (v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1]||null;
}
