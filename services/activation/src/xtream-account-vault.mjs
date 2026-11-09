// Encrypted account credential vault for authenticated BLOFY STREAM operator.
// Authentication still verifies the original one-way password proof.
// Vault never appears in bulk account listings or logs. Accounts created
// before enabling this vault have no retrievable password and must be reset.
import crypto from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function vaultKey(keyHex){
 if(!/^[a-fA-F0-9]{64}$/.test(String(keyHex||'')))throw Error('account_vault_key_invalid');
 return crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
  .update('blofy-xtream-account-vault:v1').digest();
}
export function encryptGatewayAccountPassword(id,password,keyHex,random=crypto.randomBytes){
 if(!UUID.test(String(id||'')))throw Error('account_vault_id_invalid');
 const secret=String(password||'');
 if(!/^[a-zA-Z0-9_-]{8,64}$/.test(secret))throw Error('account_vault_password_invalid');
 const iv=random(12),cipher=crypto.createCipheriv('aes-256-gcm',vaultKey(keyHex),iv);
 cipher.setAAD(Buffer.from(String(id).toLowerCase(),'utf8'));
 const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return 'v1:'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function decryptGatewayAccountPassword(id,payload,keyHex){
 if(!UUID.test(String(id||''))||!/^v1:[a-zA-Z0-9_-]{48,160}$/.test(String(payload||'')))
   return null;
 try{
  const bytes=Buffer.from(payload.slice(3),'base64url');
  if(bytes.length<28)return null;
  const decipher=crypto.createDecipheriv('aes-256-gcm',vaultKey(keyHex),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  decipher.setAAD(Buffer.from(String(id).toLowerCase(),'utf8'));
  const secret=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
  return /^[a-zA-Z0-9_-]{8,64}$/.test(secret)?secret:null;
 }catch{return null}
}
