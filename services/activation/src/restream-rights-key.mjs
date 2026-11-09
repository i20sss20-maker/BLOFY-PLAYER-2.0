// Derive a non-reversible, rights-isolated key for sharing permitted media.
// A publisher MUST NOT be shared across sources, credentials, playback
// rights, output profiles or channel identifiers unless explicitly identical.
import crypto from 'node:crypto';
const SAFE=/^[a-zA-Z0-9._:-]{1,128}$/;
export function deriveRightsScopedStreamKey({sourceId,channelId,rightsScope,
 outputProfile='hls',sourceCredentialVersion,authorized=false}={},secret=''){
 if(authorized!==true||typeof secret!=='string'||secret.length<24)
  throw Error('shared_stream_not_authorized');
 for(const v of [sourceId,channelId,rightsScope,outputProfile,sourceCredentialVersion]){
  if(typeof v!=='string'||!SAFE.test(v))throw Error('shared_stream_invalid_identity');
 }
 return crypto.createHmac('sha256',secret).update(JSON.stringify([
  'blofy-stream-lease-v1',sourceId,channelId,rightsScope,outputProfile,sourceCredentialVersion
 ])).digest('hex');
}
