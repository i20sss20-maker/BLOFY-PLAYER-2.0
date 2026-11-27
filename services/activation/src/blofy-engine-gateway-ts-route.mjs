import {randomUUID,createHmac} from 'node:crypto';
import {createEngineTsCompatibility} from './blofy-engine-ts-compat.mjs';
import {createEngineWorkerPart} from './blofy-engine-worker-part.mjs';
// Only route a pre-existing, committed feed. This module cannot start one.
// The gateway must call it after authentication and distributor catalog ACL,
// before legacy ingress. Never fall back after claiming the engine route.
export function createGatewayTsRoute({enabled=false,sourceId,testAccountId,readOwnedFeed,readProof,ledger,recheck,keys={},clock=Date.now,fetchImpl=fetch}={}){
 return async function route(req,res,{account,row,kind,extension}={}){
  if(!enabled||kind!=='live'||row?.server_id!==sourceId||account?.id!==testAccountId)return false;
  const deny=()=>{if(!res.headersSent&&!res.destroyed){res.writeHead(503,{'retry-after':'3','cache-control':'no-store'});res.end('Playback temporarily unavailable')}else if(!res.destroyed)res.destroy();return true};
  if(req.method!=='GET'||extension!=='ts')return false;
  let session;
  try{
   const feed=await readOwnedFeed(sourceId);
   if(feed?.mode==='legacy')return false;
   if(feed?.mode!=='engine'||feed.state!=='ready'||feed.sourceId!==sourceId||feed.channelId!==String(row.source_id)||!['hostbrr','linode'].includes(feed.engineId)||!/^[a-f0-9]{32}$/.test(feed.generation??''))return deny();
   const {engineId,channelId,reservationId,generation}=feed;
   const identity={sourceId,engineId,channelId,reservationId,generation};
   const accountId=account.id,sessionId=randomUUID();
   const key=keys[engineId];
   if(!Buffer.isBuffer(key)||key.length!==32)return deny();
   const authorizeGrant=async()=>{
    if(req.aborted||res.destroyed)return {ok:false};
    const current=await recheck({accountId,sourceId,channelId});
    if(current?.ok!==true)return {ok:false};
    const latest=await readOwnedFeed(sourceId);
    if(latest?.mode!=='engine'||latest.state!=='ready'||!Object.keys(identity).every(k=>latest[k]===identity[k]))return {ok:false};
    const proof=await readProof(identity),now=clock();
    if(!proof||!Object.keys(identity).every(k=>proof[k]===identity[k])||!Number.isSafeInteger(proof.observedAt)||proof.observedAt<now-10000||proof.observedAt>now+2000)return {ok:false};
    const attached=await ledger.attachViewer({...identity,sessionId,accountId,accountQuota:current.accountQuota,authorizedUntil:current.authorizedUntil});
    if(!attached?.ok)return {ok:false};
    session={sourceId,reservationId,sessionId,accountId,engineId};
    const expiry=Math.floor(Math.min(Date.parse(attached.expiresAt),now+60000)/1000);
    if(!Number.isSafeInteger(expiry)||expiry<=Math.floor(now/1000)+5)return {ok:false};
    const a=accountId.replaceAll('-','').toLowerCase();
    const mac=createHmac('sha256',key).update(['BLOFY-LIVE-V1',generation,a,String(expiry)].join('\n')).digest('hex');
    return {ok:true,mediaHost:engineId==='hostbrr'?'media2.blofyplayer.com':'media.blofyplayer.com',path:'/v1/'+generation+'/'+a+'/'+expiry+'/'+mac+'/index.m3u8'};
   };
   const read=createEngineWorkerPart({enabled:true,authorizeGrant,clock,fetchImpl});
   const deliver=createEngineTsCompatibility({enabled:true,fetchPart:read,clock});
   await deliver(req,res,{...identity,accountId});
   return true;
  }catch{return deny()}
  finally{if(session)try{await ledger.closeViewer(session)}catch{}}
 };
}
