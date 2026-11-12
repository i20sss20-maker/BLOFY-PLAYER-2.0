// Shared, stable device proof used for re-login and token verification.
// Never persist, log or return the client's installation secret.
import crypto from 'node:crypto';
const DEVICE_KEY=/^[a-f0-9]{64}$/i;
const validDate=value=>value?new Date(value).getTime():0;
export function streamDeviceProof(deviceKey,keyHex) {
  if(!DEVICE_KEY.test(String(deviceKey||''))||
     !DEVICE_KEY.test(String(keyHex||'')))return null;
  return crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
    .update('blofy-stream-activation-device:v1:'+String(deviceKey).toLowerCase())
    .digest('hex');
}
export function hasApprovedRelogin(row,deviceProof,now=Date.now()) {
  return Boolean(row&&deviceProof&&
    row.code_channel==='app'&&
    row.relogin_device_hash===deviceProof &&
    row.relogin_request_hash &&
    validDate(row.relogin_approved_at)>0 &&
    validDate(row.relogin_expires_at)>now);
}
