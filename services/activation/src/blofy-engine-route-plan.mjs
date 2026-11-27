// Internal pure routing decision. No source calls or customer route changes.
// Snapshot evidence must be authenticated by the caller; health alone never
// establishes source entitlement, reservation ownership or provider release.
const engines=['hostbrr','linode'];
const hold=reason=>({action:'hold',reason});
export function planEngineRoute({feed,workers,feedProof,capacity,entitlement,request,now=Date.now(),enabled=false}={}){
 if(!enabled)return hold('disabled');
 if(!request?.sourceId||!request?.channelId||request.authorized!==true||
    !Number.isFinite(request.expiresAt)||request.expiresAt<=now)return hold('request_unauthorized');
 if(entitlement?.sourceId!==request.sourceId||entitlement.redistributionAllowed!==true||
    !Number.isFinite(entitlement.expiresAt)||entitlement.expiresAt<=now)return hold('entitlement_unconfirmed');
 const fresh=w=>w?.authenticated===true&&Number.isFinite(w.observedAt)&&w.observedAt>=now-15000&&w.observedAt<=now+2000;
 const healthy=id=>engines.includes(id)&&fresh(workers?.[id])&&workers[id].deliveryActive===true&&workers[id].heartbeatActive===true;
 if(!feed||feed.sourceId!==request.sourceId)return hold('ledger_unconfirmed');
 if(feed.state==='ready'){
  if(!engines.includes(feed.engineId)||!feed.reservationId||!feed.generation)return hold('invalid_feed_identity');
  if(feed.channelId!==request.channelId)return hold('source_busy');
  const verified=feedProof?.authenticated===true&&feedProof.status==='private_hls_ready'&&
    ['sourceId','engineId','channelId','reservationId','generation'].every(k=>feedProof[k]===feed[k])&&
    feedProof.localSourceConnections===1&&Number.isSafeInteger(feedProof.lastSegment)&&feedProof.lastSegment>=0&&
    Number.isFinite(feedProof.observedAt)&&feedProof.observedAt>=now-10000&&feedProof.observedAt<=now+2000;
  if(healthy(feed.engineId)&&verified)return {action:'reuse',engineId:feed.engineId,reservationId:feed.reservationId,generation:feed.generation};
  if(healthy(feed.engineId)&&!verified)return hold('feed_progress_unconfirmed');
  // Health loss requests reconciliation, never a new source connection.
  return {action:'request_fenced_release',engineId:feed.engineId,reservationId:feed.reservationId};
 }
 if(!['empty','released'].includes(feed.state))return hold('reservation_unresolved');
 if(feed.state==='released'&&feed.releaseConfirmed!==true)return hold('release_unconfirmed');
 if(capacity?.sourceId!==request.sourceId||capacity.authoritative!==true||
    !['all_paths','dedicated_licensed_pool'].includes(capacity.scope)||
    capacity.activeConnections!==0||capacity.maxConnections!==1||
    !Number.isFinite(capacity.observedAt)||capacity.observedAt<now-10000||capacity.observedAt>now+2000)return hold('capacity_unconfirmed');
 const eligible=engines.filter(id=>healthy(id)&&Number.isSafeInteger(workers[id].activeViewers)&&workers[id].activeViewers>=0&&Number.isSafeInteger(workers[id].viewerLimit)&&workers[id].viewerLimit>workers[id].activeViewers);
 // HostBrr is primary. Linode is standby, not a load-balancing peer.
 eligible.sort((a,b)=>engines.indexOf(a)-engines.indexOf(b));
 if(!eligible.length)return hold('no_healthy_capacity');
 return {action:'request_reservation',engineId:eligible[0]};
}
// A new reservation must still pass the authoritative transactional ledger and
// start coordinator. Do not directly issue viewer grants from this plan.
