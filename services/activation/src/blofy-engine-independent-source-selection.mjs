// Shadow source selection only; no upstream request, grant, DB write or routing.
// Inputs must originate from authenticated entitlement and authority readers.
// quotaGroupId identifies the actual provider account/quota, NOT an engine,
// hostname, alias or arbitrarily generated identifier.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const channel=/^[1-9][0-9]{0,14}$/;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const occupied=new Set(['reserved','starting','ready','draining','release_unknown']);
const hold=reason=>({action:'hold',reason,shadowOnly:true});
export function selectIndependentLiveSource({request,inventory,now=Date.now(),enabled=false}={}){
 if(!enabled)return hold('disabled');
 if(request?.authorized!==true||!channel.test(request.channelId??'')||
    !Number.isFinite(request.expiresAt)||request.expiresAt<=now)return hold('request_unauthorized');
 const fresh=x=>x?.authenticated===true&&Number.isFinite(x.observedAt)&&
   x.observedAt>=now-10000&&x.observedAt<=now+2000;
 if(!fresh(inventory)||inventory.complete!==true||!Array.isArray(inventory.sources)||
    inventory.sources.length<1||inventory.sources.length>64)return hold('inventory_unconfirmed');
 const ids=new Set(),groups=new Set(),mapped=[];
 for(const s of inventory.sources){
  const e=s?.entitlement,a=s?.authority;
  if(!uuid.test(s?.sourceId??'')||ids.has(s.sourceId)||
     !uuid.test(e?.quotaGroupId??'')||groups.has(e.quotaGroupId)||
     e.sourceId!==s.sourceId||e.redistributionAllowed!==true||e.independentQuotaVerified!==true||
     !Number.isFinite(e.expiresAt)||e.expiresAt<=now||
     !count(e.maxFeeds)||e.maxFeeds<1||e.maxFeeds>512)return hold('entitlement_unconfirmed_or_duplicate_quota');
  ids.add(s.sourceId);groups.add(e.quotaGroupId);
  if(!fresh(a)||a.sourceId!==s.sourceId||a.allPathsFenced!==true||
     a.mode!=='engine_only'||a.legacyHolds!==0||!count(a.revision)||
     !count(a.activeConnections)||!Array.isArray(a.reservations)||
     a.reservations.length>512)return hold('authority_unconfirmed');
  const channelIds=new Set(),reservationIds=new Set();
  for(const r of a.reservations){
   if(r?.sourceId!==s.sourceId||!uuid.test(r.reservationId??'')||
      reservationIds.has(r.reservationId)||!channel.test(r.channelId??'')||
      channelIds.has(r.channelId)||!occupied.has(r.state))return hold('reservation_invalid');
   reservationIds.add(r.reservationId);channelIds.add(r.channelId);
  }
  if(a.activeConnections>a.reservations.length)return hold('untracked_connection');
  // Mapping must be authoritative and complete, including historical aliases
  // that could still have a reservation for the requested canonical channel.
  const m=s.mapping;
  if(!fresh(m)||m.sourceId!==s.sourceId||m.canonicalChannelId!==request.channelId||
     !Array.isArray(m.providerChannelIds)||m.providerChannelIds.length>64||
     !m.providerChannelIds.every(x=>channel.test(x))||
     new Set(m.providerChannelIds).size!==m.providerChannelIds.length||
     (m.preferredChannelId!==null&&!m.providerChannelIds.includes(m.preferredChannelId)))
    return hold('channel_mapping_unconfirmed');
  const active=a.reservations.filter(r=>m.providerChannelIds.includes(r.channelId));
  mapped.push({s,e,a,m,active});
 }
 const existing=mapped.flatMap(x=>x.active.map(r=>({x,r})));
 if(existing.length>1)return hold('duplicate_channel_ownership');
 if(existing.length===1){
  const {x,r}=existing[0];
  if(r.state!=='ready')return hold('existing_channel_not_released');
  return {action:'check_existing',shadowOnly:true,sourceId:x.s.sourceId,
   channelId:r.channelId,reservationId:r.reservationId,snapshotRevision:x.a.revision};
 }
 const available=mapped.filter(x=>x.m.preferredChannelId!==null&&x.a.reservations.length<x.e.maxFeeds);
 if(!available.length)return hold('no_authorized_source_capacity');
 // Stable best available capacity. Never count aliases as new slots.
 available.sort((a,b)=>(b.e.maxFeeds-b.a.reservations.length)-(a.e.maxFeeds-a.a.reservations.length)||
   a.s.sourceId.localeCompare(b.s.sourceId));
 const x=available[0];
 return {action:'check_admission',shadowOnly:true,sourceId:x.s.sourceId,
  channelId:x.m.preferredChannelId,snapshotRevision:x.a.revision};
}
