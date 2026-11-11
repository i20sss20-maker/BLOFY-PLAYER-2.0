// Encrypted, operator-only future subscription-code vault.
// The redemption HMAC remains authoritative; these ciphertexts are used
// only when the authenticated operator explicitly copies a code.
import crypto from 'node:crypto';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function key(hex){
  if(!/^[0-9a-f]{64}$/i.test(String(hex||'')))throw Error('stream_code_vault_key_invalid');
  return crypto.createHmac('sha256',Buffer.from(hex,'hex'))
    .update('blofy-stream-code-vault:v1','utf8').digest();
}
export function encryptStreamCode(id,code,keyHex,random=crypto.randomBytes){
  if(!ID.test(String(id||''))||!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(String(code||'')))
    throw Error('stream_code_vault_input_invalid');
  const iv=random(12);
  if(iv.length!==12)throw Error('stream_code_vault_iv_invalid');
  const cipher=crypto.createCipheriv('aes-256-gcm',key(keyHex),iv);
  cipher.setAAD(Buffer.from(String(id).toLowerCase(),'utf8'));
  const encrypted=Buffer.concat([cipher.update(String(code),'utf8'),cipher.final()]);
  return 'v1:'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function decryptStreamCode(id,payload,keyHex){
  if(!ID.test(String(id||''))||typeof payload!=='string'||
      !/^v1:[A-Za-z0-9_-]{40,140}$/.test(payload))return null;
  try{
    const encoded=payload.slice(3);
    const buf=Buffer.from(encoded,'base64url');
    // Reject non-canonical base64url spellings of the same ciphertext.
    // Trailing unused bits can otherwise change without changing decoded bytes.
    if(buf.length<36||buf.toString('base64url')!==encoded)return null;
    const dec=crypto.createDecipheriv('aes-256-gcm',key(keyHex),buf.subarray(0,12));
    dec.setAAD(Buffer.from(String(id).toLowerCase(),'utf8'));
    dec.setAuthTag(buf.subarray(12,28));
    const text=Buffer.concat([dec.update(buf.subarray(28)),dec.final()]).toString('utf8');
    return /^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(text)?text:null;
  }catch{return null}
}
