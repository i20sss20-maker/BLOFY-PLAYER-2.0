// Shadow-only decision for a future transactional multi-channel ledger.
// Never starts media, writes a reservation, or changes a customer's route.
// The caller must authenticate the evidence and atomically recheck the
// snapshot revision and source-wide capacity before committing any action.
const engines=['hostbrr','linode'];
const hold=reason=>({action:'hold',reason});
const validCount=n=>Number.isSafeInteger(n)&&n>=0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const channel=/^[1-9][0-9]{0,14}$/;
const occupiedStates=new Set(['reserved','starting','ready','draining','release_unknown']);
export function planMultiChannelAdmission({request,entitlement,snapshot,workers,now=Date.now(),enabled=false}={}){
 if(!enabled)return hold('disabled');
 const sourceId=request?.sourceId,channelId=request?.channelId;
 if(!uuid.test(sourceId??'')||!channel.test(channelId??'')||request.authorized!==true||
    !Number.isFinite(request.expiresAt)||request.expiresAt<=now)return hold('request_unauthorized');
 if(entitlement?.sourceId!==sourceId||entitlement.redistributionAllowed!==true||
    !Number.isFinite(entitlement.expiresAt)||entitlement.expiresAt<=now||
    !validCount(entitlement.maxFeeds)||entitlement.maxFeeds<1||entitlement.maxFeeds>512)
   return hold('entitlement_unconfirmed');
 const fresh=(value,maxAge)=>value?.authenticated===true&&Number.isFinite(value.observedAt)&&
   value.observedAt>=now-maxAge&&value.observedAt<=now+2000;
 if(!fresh(snapshot,10000)||snapshot.sourceId!==sourceId||snapshot.allPathsFenced!==true||
    snapshot.legacyHolds!==0||snapshot.mode!=='engine_only'||
    !validCount(snapshot.revision)||!validCount(snapshot.activeConnections)||
    !Array.isArray(snapshot.reservations)||snapshot.reservations.length>512)
   return hold('source_authority_unconfirmed');
 const reservations=snapshot.reservations;
 const ids=new Set(),channels=new Set();
 for(const r of reservations){
  if(r?.sourceId!==sourceId||!uuid.test(r.reservationId??'')||!channel.test(r.channelId??'')||
     !engines.includes(r.engineId)||!occupiedStates.has(r.state)||
     ids.has(r.reservationId)||channels.has(r.channelId))return hold('reservation_snapshot_invalid');
  ids.add(r.reservationId);channels.add(r.channelId);
 }
 if(snapshot.activeConnections>reservations.length)return hold('untracked_source_connection');
 const decision=(action,extra)=>({action,sourceId,channelId,snapshotRevision:snapshot.revision,...extra});
 const healthy=id=>fresh(workers?.[id],15000)&&workers[id].deliveryActive===true&&
   workers[id].heartbeatActive===true;
 const room=(id,needFeed)=>{
  const w=workers?.[id];
  if(!healthy(id)||!validCount(w.activeViewers)||!validCount(w.viewerLimit)||
     w.activeViewers>=w.viewerLimit)return false;
  if(!needFeed)return true;
  const local=reservations.filter(r=>r.engineId===id).length;
  return validCount(w.maxFeeds)&&validCount(w.activeFeeds)&&w.activeFeeds<=local&&local<w.maxFeeds;
 };
 const existing=reservations.find(r=>r.channelId===channelId);
 if(existing){
  if(existing.state!=='ready')return hold('reservation_pending_or_unreleased');
  if(!healthy(existing.engineId))return decision('request_fenced_release',{
    engineId:existing.engineId,reservationId:existing.reservationId});
  const proof=existing.proof;
  if(!fresh(proof,10000)||proof.status!=='private_hls_ready'||
     !/^[a-f0-9]{32}$/.test(existing.generation??'')||
     !['sourceId','channelId','engineId','reservationId','generation'].every(k=>proof[k]===existing[k])||
     proof.localSourceConnections!==1||!validCount(proof.lastSegment))
    return hold('feed_progress_unconfirmed');
  if(!room(existing.engineId,false))return hold('viewer_capacity');
  return decision('reuse',{engineId:existing.engineId,reservationId:existing.reservationId,generation:existing.generation});
 }
 // Pending/releasing/unknown reservations occupy capacity until proven
 // released. Never count a second engine as additional provider capacity.
 if(reservations.length>=entitlement.maxFeeds)return hold('source_capacity');
 const primary=healthy('hostbrr');
 // Standby is only for primary health loss, not overflow or double publishing.
 const selected=primary?'hostbrr':'linode';
 if(!room(selected,true))return hold('no_healthy_capacity');
 return decision('request_reservation',{engineId:selected,maxFeeds:entitlement.maxFeeds});
}
