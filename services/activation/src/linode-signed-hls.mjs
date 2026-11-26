import {createHmac} from 'node:crypto';
import {decideLinodeAdmission} from './linode-media-admission.mjs';
// Interoperates with Linode delivery.py BLOFY-LIVE-V1. No network access,
// no source reservation, and no public route. Only call with server-owned
// authenticated catalog context, committed reservation and fresh worker state.
const gen=/^[0-9a-f]{32}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied=reason=>({ok:false,reason});
export function signedLinodePlayback({context,requestId,capacity,attempt,worker,signingKey,hostbrrSigningKey}={},env=process.env,now=Date.now()){
 if(env.BLOFY_LINODE_SIGNED_HLS!=='1')return denied('disabled');
 const decision=decideLinodeAdmission({context,requestId,capacity,attempt},env,now);
 if(decision.action!=='linode')return denied('admission_not_committed');
 const engineId=context?.engineId??'linode';
 if((worker?.engineId??'linode')!==engineId)return denied('engine_mismatch');
 const a=context?.account?.id;
 const observed=Date.parse(worker?.observedAt);
 if(!uuid.test(a||'')||!gen.test(worker?.generation||'')||
    worker?.status!=='private_hls_ready'||worker?.sourceId!==context.row.server_id||
    worker?.channelId!==context.row.source_id||
    worker?.reservationId!==decision.reservationId||
    !Number.isFinite(observed)||observed<now-10000||observed>now+2000)
   return denied('worker_not_verified');
 if(engineId==='hostbrr'&&env.BLOFY_HOSTBRR_SIGNED_HLS!=='1')return denied('engine_signing_disabled');
 const key=engineId==='hostbrr'?hostbrrSigningKey:signingKey;
 if(!Buffer.isBuffer(key)||key.length!==32)return denied('key_unavailable');
 const account=a.replaceAll('-','').toLowerCase();
 const expiry=Math.floor(Math.min(Date.parse(decision.expiresAt),now+60000)/1000);
 if(!Number.isSafeInteger(expiry)||expiry<=Math.floor(now/1000)+5)return denied('grant_too_short');
 const generation=worker.generation;
 const mac=createHmac('sha256',key).update(['BLOFY-LIVE-V1',generation,account,String(expiry)].join('\n')).digest('hex');
 // Path only. Never expose the source URL, signing key, or reservation ID.
 // The caller still has to prove the HTTPS delivery ingress is enabled.
 return {ok:true,mediaHost:engineId==='hostbrr'?'media2.blofyplayer.com':'media.blofyplayer.com',path:'/v1/'+generation+'/'+account+'/'+expiry+'/'+mac+'/index.m3u8',expiresAt:new Date(expiry*1000).toISOString()};
}
