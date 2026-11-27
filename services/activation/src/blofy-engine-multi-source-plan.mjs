import {planEngineRoute} from './blofy-engine-route-plan.mjs';

// Internal planning only. Every candidate must be a separately licensed,
// independently verified upstream account for the exact requested content.
// sourceId is a catalog row; poolId is the trusted canonical account identity.
// Multiple catalog aliases of one account never create extra upstream capacity.
// The caller must reserve using the canonical pool's transactional ledger,
// then recheck authorization, worker capacity and physical source ownership.
export function planMultiSourceRoute({candidates,workers,request,now=Date.now(),enabled=false}={}){
 const hold=reason=>({action:'hold',reason});
 if(!enabled)return hold('disabled');
 if(request?.authorized!==true||typeof request.contentId!=='string'||!request.contentId||
    !Number.isFinite(request.expiresAt)||request.expiresAt<=now)return hold('request_unauthorized');
 if(!Array.isArray(candidates)||candidates.length>1000)return hold('invalid_inventory');
 const pools=new Map(),sources=new Set();
 for(const c of candidates){
  if(!c||typeof c.poolId!=='string'||!c.poolId||typeof c.sourceId!=='string'||!c.sourceId)continue;
  // Ambiguous identity is never admissible, even if one alias is healthy.
  if(sources.has(c.sourceId))return hold('duplicate_source_identity');
  sources.add(c.sourceId);
  const list=pools.get(c.poolId)||[];list.push(c);pools.set(c.poolId,list);
 }
 const plans=[];
 for(const list of pools.values()){
  if(list.length!==1)continue;
  const c=list[0],i=c.identity;
  if(i?.authenticated!==true||i.independentPoolVerified!==true||
     i.poolId!==c.poolId||i.sourceId!==c.sourceId||
     !Number.isFinite(i.observedAt)||i.observedAt<now-300000||i.observedAt>now+2000||
     c.contentId!==request.contentId||typeof c.channelId!=='string'||!c.channelId)continue;
  // A worker's viewer headroom is NOT upstream feed headroom. The existing
  // systemd runtime supports one feed per engine. A future multi-feed worker
  // must publish authenticated feed limits before it can be selected.
  const workerSnapshot=Object.fromEntries(Object.entries(workers||{}).filter(([id,w])=>{
   if(!Number.isSafeInteger(w?.feedLimit)||w.feedLimit<1||
      !Number.isSafeInteger(w?.activeFeeds)||w.activeFeeds<0||w.activeFeeds>w.feedLimit)return false;
   if(c.feed?.state==='ready'&&c.feed.engineId===id)return w.activeFeeds>0;
   return w.activeFeeds<w.feedLimit;
  }));
  const plan=planEngineRoute({feed:c.feed,workers:workerSnapshot,feedProof:c.feedProof,
   capacity:c.capacity,entitlement:c.entitlement,
   request:{authorized:true,sourceId:c.sourceId,channelId:c.channelId,expiresAt:request.expiresAt},now,enabled:true});
  if(!['reuse','request_reservation'].includes(plan.action))continue;
  const w=workerSnapshot[plan.engineId];
  if(!Number.isSafeInteger(w?.viewerLimit)||!Number.isSafeInteger(w?.activeViewers)||
     w.activeViewers<0||w.viewerLimit<=w.activeViewers)continue;
  plans.push({...plan,sourceId:c.sourceId,poolId:c.poolId,channelId:c.channelId,
   load:w.activeViewers/w.viewerLimit});
 }
 plans.sort((a,b)=>Number(b.action==='reuse')-Number(a.action==='reuse')||
  a.load-b.load||a.poolId.localeCompare(b.poolId));
 if(!plans.length)return hold('no_independent_authorized_capacity');
 const {load,...selected}=plans[0];
 return selected;
}
