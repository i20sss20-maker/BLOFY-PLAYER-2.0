// In-process gauge of REAL direct HTTP media transfers to the customer.
// The transfer starts only after authenticated provider bytes are validated.
// It is not a unique-viewer count and excludes 307 relay/fanout redirects,
// independent media service, HLS segment requests, and other Railway replicas.
// No customer identifiers, IP, source URL, password, token or channel ID.
const TYPES=new Set(['live','movie','series']);
const SOURCE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createXtreamDirectMediaGauge({maxTracked=4096,clock=Date.now}={}){
  if(!Number.isInteger(maxTracked)||maxTracked<1||maxTracked>8192||
    typeof clock!=='function')throw Error('direct_transfer_config_invalid');
  const active=new Map();
  let seq=0,started=0,completed=0,capacityExceeded=false;
  function begin({kind,sourceId}={}){
    if(!TYPES.has(kind)||typeof sourceId!=='string'||!SOURCE.test(sourceId))
      return ()=>{};
    started++;
    if(active.size>=maxTracked){
      capacityExceeded=true;
      // Never evict an active record and lie about actual connections.
      return ()=>{};
    }
    const token=++seq;
    active.set(token,{kind,sourceId:sourceId.toLowerCase(),at:clock()});
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      if(active.delete(token))completed++;
    };
  }
  function snapshot(){
    const now=clock(),byKind={live:0,movie:0,series:0},sources=new Map();
    let longestActiveMs=0;
    for(const item of active.values()){
      byKind[item.kind]++;
      const prev=sources.get(item.sourceId)||{sourceId:item.sourceId,
        activeDirectHttpTransfers:0,activeDirectLiveHttpTransfers:0};
      prev.activeDirectHttpTransfers++;
      if(item.kind==='live')prev.activeDirectLiveHttpTransfers++;
      sources.set(item.sourceId,prev);
      longestActiveMs=Math.max(longestActiveMs,
        Math.min(86400000,Math.max(0,now-item.at)));
    }
    return {ok:true,scope:'this_portal_process_direct_http_media_only',
      countIsUniqueViewers:false,countIsProviderConnections:false,
      includesRedirects:false,includesHlsSegments:false,
      includesIndependentEdge:false,includesOtherReplicas:false,
      directTransfersMeasured:true,countsReliable:!capacityExceeded,
      saturationObserved:capacityExceeded,checkedAt:now,
      activeDirectHttpTransfers:active.size,
      activeDirectLiveHttpTransfers:byKind.live,
      activeByKind:byKind,longestActiveMs,
      transfersStartedSinceBoot:started,transfersClosedSinceBoot:completed,
      bySource:[...sources.values()].slice(0,64)};
  }
  return {begin,snapshot};
}

// Only this Node process's direct media proxy can populate this gauge.
export const xtreamDirectMediaGauge=createXtreamDirectMediaGauge();
