import {observeEdgeBody} from '../../src/xtream-edge-body-lifecycle.mjs';
// BLOFY STREAM standalone Xtream-compatible public edge.
// Existing subscriber storage and upstream services are not changed.
const ORIGIN = Bun.env.EDGE_FIXTURE_ORIGIN;
if(!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(ORIGIN||''))throw Error('loopback fixture only');
const PORT = Number(Bun.env.PORT || 3000);
// Optional secret-protected EDGE observability. No raw URL, IP, credentials,
// query, username or stream ID is retained. In-memory, per Bun instance only.
const EDGE_METRICS_KEY = String(Bun.env.BLOFY_STREAM_EDGE_OBSERVABILITY_KEY || '');
const ROUTE_KINDS = ['api','hls','live','movie','series'];
const counters = {
  sinceBootRequests:0,upstreamErrors:0,admissionRefusals:0,
  inflightOriginHeaders:0,byKind:Object.fromEntries(ROUTE_KINDS.map(x=>[x,0])),
  responseClasses:{'2xx':0,'3xx':0,'4xx':0,'5xx':0}
};
const minuteBuckets=[];
const headerTimes=[];
const MAX_HEADER_SAMPLES=256;
function addEdgeMetricStart(kind){
  counters.inflightOriginHeaders++;
  counters.sinceBootRequests++;
  counters.byKind[kind]++;
  const minute=Math.floor(Date.now()/60000);
  let bucket=minuteBuckets.at(-1);
  if(!bucket||bucket.minute!==minute){
    bucket={minute,requests:0,errors5xx:0,admissionRefusals:0};
    minuteBuckets.push(bucket);
    while(minuteBuckets.length>15)minuteBuckets.shift();
  }
  bucket.requests++;
  let ended=false;
  return (status,elapsed)=>{
    if(ended)return;
    ended=true;
    counters.inflightOriginHeaders=Math.max(0,counters.inflightOriginHeaders-1);
    const code=Number(status)||502;
    const family=Math.floor(code/100);
    const key=family+'xx';
    if(Object.hasOwn(counters.responseClasses,key))counters.responseClasses[key]++;
    if(family===5){counters.upstreamErrors++;bucket.errors5xx++}
    if([401,403,429,456].includes(code)){
      counters.admissionRefusals++;bucket.admissionRefusals++;
    }
    if(Number.isFinite(elapsed)&&elapsed>=0){
      headerTimes.push(Math.min(120000,Math.round(elapsed)));
      if(headerTimes.length>MAX_HEADER_SAMPLES)headerTimes.shift();
    }
  };
}
function edgeMetricsSnapshot(){
  const now=Date.now(),minute=Math.floor(now/60000);
  const samples=headerTimes.slice().sort((a,b)=>a-b);
  const p95=samples.length?samples[Math.ceil(samples.length*.95)-1]:null;
  const latest=minuteBuckets.filter(x=>x.minute>=minute-4&&x.minute<=minute);
  return {
    ok:true,scope:'one_xtream_edge_bun_instance_origin_headers_only',
    checkedAt:now,readOnly:true,actionsTaken:0,
    activeOriginHeaderRequests:counters.inflightOriginHeaders,
    totalOriginRequestsSinceBoot:counters.sinceBootRequests,
    originResponseClasses:{...counters.responseClasses},
    byKind:{...counters.byKind},
    upstream5xxSinceBoot:counters.upstreamErrors,
    sourceAdmissionRefusalsSinceBoot:counters.admissionRefusals,
    lastFiveMinutes:{
      requests:latest.reduce((n,x)=>n+x.requests,0),
      errors5xx:latest.reduce((n,x)=>n+x.errors5xx,0),
      admissionRefusals:latest.reduce((n,x)=>n+x.admissionRefusals,0)
    },
    p95OriginHeadersMs:p95,headerSamples:samples.length,
    countsAreUniqueViewers:false,countsAreActiveVideoStreams:false,
    mediaBodyConsumptionMeasured:false,observedLiveBodies:{...liveBodyCounts},countsAcrossReplicas:false,
    sourceRightsVerified:false
  };
}
async function authorizedEdgeMetrics(req){
  const sent=req.headers.get('x-blofy-edge-observer')||'';
  if(EDGE_METRICS_KEY.length<32||EDGE_METRICS_KEY.length>128||
     sent.length<32||sent.length>128)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(EDGE_METRICS_KEY)),
    crypto.subtle.digest('SHA-256',enc.encode(sent))
  ]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  let diff=0;
  for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  return diff===0;
}
const PUBLIC_HOST = String(Bun.env.BLOFY_PUBLIC_XTREAM_HOST || '').toLowerCase().trim();
const ALLOWED_GATEWAY_METHODS = new Set(['GET', 'HEAD']);
const media = /^\/(live|movie|series)\/[^/]{1,128}\/[^/]{1,128}\/[0-9]{1,16}(?:\.[a-zA-Z0-9]{1,8})?$/;
const api = new Set(['/player_api.php', '/panel_api.php', '/get.php', '/xmltv.php']);
// HLS tickets are encrypted by the authoritative Xtream gateway; only that gateway decrypts them.
const hls = /^\/hls\/[A-Za-z0-9_]{4,32}\/[A-Za-z0-9_-]{8,64}\/[1-9][0-9]{0,15}\/[A-Za-z0-9_-]{50,6000}$/;
// Xtream clients commonly request /USER/PASS/ID (without /live or .ts).
// Restrict this alias to valid BLOFY login characters and positive IDs.
// Normalize a double leading slash from player URL concatenation, too.
const legacyMedia = /^\/([A-Za-z0-9_]{4,32})\/([A-Za-z0-9_-]{8,64})\/([1-9][0-9]{0,15})(?:\.(ts|m3u8))?$/i;
function canonicalMediaPath(path) {
  const clean=path.replace(/^\/{2,3}(?=[A-Za-z0-9])/, '/');
  if(media.test(clean))return clean;
  const match=legacyMedia.exec(clean);
  return match ? '/live/'+match[1]+'/'+match[2]+'/'+match[3]+'.'+(match[4]||'ts').toLowerCase() : null;
}

function response(status, body) {
 return new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
const liveBodyCounts={eof:0,client_cancelled:0,upstream_body_error:0};
function recordEdgeLiveBody(event){
 if(!Object.hasOwn(liveBodyCounts,event.reason))return;
 liveBodyCounts[event.reason]++;
 if(event.reason==='upstream_body_error')
  console.info('BLOFY_EDGE_LIVE_BODY_END',JSON.stringify({reason:event.reason,bytes:event.bytes,elapsedMs:event.elapsedMs}));
}
const server = Bun.serve({port:PORT, idleTimeout: 255, async fetch(req) {
  const start = new URL(req.url);
  const pathname = start.pathname;
  // Never expose EDGE transport metrics publicly, even as an auth error.
  // The key must be independently configured on the API and Edge services.
  if(pathname==='/__blofy_internal/edge-metrics'){
    if(req.method!=='GET'||!(await authorizedEdgeMetrics(req)))
      return response(404,{error:'not_found'});
    return response(200,edgeMetricsSnapshot());
  }
  if (pathname === '/health' && req.method === 'GET') return response(200, {ok:true, service:'blofy-xtream-edge',protocol:'Xtream Codes'});
  if (pathname === '/' && req.method === 'GET') return response(200,{service:'BLOFY Xtream',status:'online',playerApi:'/player_api.php'});
  if (pathname === '/favicon.ico' && req.method === 'GET') return new Response(null,{status:204});
  const mediaPath=canonicalMediaPath(pathname);
  const isHls=hls.test(pathname);
  if (!api.has(pathname) && !mediaPath && !isHls) return response(404,{error:'not_found'});
  if ((mediaPath||isHls) && !ALLOWED_GATEWAY_METHODS.has(req.method)) return response(405,{error:'method_not_allowed'});
  if (api.has(pathname) && !['GET','HEAD','POST'].includes(req.method)) return response(405,{error:'method_not_allowed'});
  if (pathname === '/get.php' || pathname === '/xmltv.php') {
    if (req.method === 'POST') return response(405,{error:'method_not_allowed'});
  }
  let payload;
  if(req.method==='POST') {
    const type=(req.headers.get('content-type')||'').split(';')[0].toLowerCase().trim();
    if (type !== 'application/x-www-form-urlencoded' && type !== 'application/json')
      return response(415,{error:'unsupported_media_type'});
    if (Number(req.headers.get('content-length')||0)>32768) return response(413,{error:'payload_too_large'});
    payload = await req.arrayBuffer();
    if (payload.byteLength > 32768) return response(413,{error:'payload_too_large'});
  }
  const host = PUBLIC_HOST || start.hostname.toLowerCase();
  if (!/^[a-z0-9.-]{3,160}$/.test(host) || host.startsWith('.') || host.includes('..'))
    return response(400,{error:'invalid_hostname'});
  // Never forward cookies, admin credentials or an untrusted forwarded-host.
  // Server API/M3U links must use this edge host, not the original website.
  const headers = new Headers();
  headers.set('x-forwarded-host',host);
  headers.set('x-forwarded-proto','https');
  headers.set('user-agent',(req.headers.get('user-agent')||'BLOFY-Xtream-Edge').slice(0,300));
  headers.set('accept',req.headers.get('accept')||'*/*');
  // Large Xtream JSON lists are gzip-streamed by the authoritative gateway.
  // Only forward gzip when the IPTV client explicitly accepts it.
  // Media/segments remain identity to preserve byte ranges and codecs.
  const canGzip=api.has(pathname)&&
    (pathname==='/player_api.php'||pathname==='/panel_api.php')&&
    String(req.headers.get('accept-encoding')||'').split(',').some(token=>{
      const [name,...options]=token.toLowerCase().trim().split(';').map(x=>x.trim());
      if(name!=='gzip')return false;
      const quality=options.find(x=>x.startsWith('q='));
      if(!quality)return true;
      const q=Number(quality.slice(2));
      return Number.isFinite(q)&&q>0&&q<=1;
    });
  headers.set('accept-encoding',canGzip?'gzip':'identity');
  for (const key of ['range','if-range','if-none-match','if-modified-since']) {
    const value=req.headers.get(key); if(value && value.length<1024) headers.set(key,value);
  }
  if (payload) headers.set('content-type',(req.headers.get('content-type')||'application/x-www-form-urlencoded').slice(0,120));
  const target = new URL((mediaPath||pathname)+start.search,ORIGIN);
  // Header metrics remain distinct from the live body lifecycle counter.
  // Never reopen live feeds or infer active viewers from response headers.
  const type=api.has(pathname)?'api':isHls?'hls':
    /^\/(movie|series)\//.test(mediaPath||'')?
      mediaPath.split('/')[1]:'live';
  const metricStartedAt=Date.now();
  const finishMetric=addEdgeMetricStart(type);
  try {
    let upstream=await fetch(target,{method:req.method,headers,redirect:'manual',decompress:false,body:payload||undefined,signal:req.signal});
    // A temporary 502/503/504 for file playback sometimes recovers on one
    // re-open. Retry ONLY before forwarding any bytes and ONLY for VOD/series.
    // Never replay POST, live streams or an auth denial / missing stream.
    if(req.method==='GET' && /^\/(movie|series)\//.test(mediaPath||'') &&
       [502,503,504].includes(upstream.status) && !req.signal.aborted){
      try{await upstream.body?.cancel()}catch{}
      await new Promise(resolve=>setTimeout(resolve,220));
      if(!req.signal.aborted){
        upstream=await fetch(target,{method:'GET',headers,redirect:'manual',decompress:false,signal:req.signal});
      }
    }
    // Never disclose or follow credential-bearing redirects to another host.
    if(upstream.status>=300 && upstream.status<400 && upstream.headers.has('location')){
      finishMetric(502,Date.now()-metricStartedAt);
      return response(502,{error:'origin_redirect_denied'});
    }
    const out = new Headers();
    for (const key of ['content-type','content-length','content-range','accept-ranges','etag','last-modified','cache-control','content-encoding','vary']) {
      const value=upstream.headers.get(key); if(value) out.set(key,value);
    }
    out.set('cache-control','no-store');
    out.set('x-content-type-options','nosniff');
    out.set('referrer-policy','no-referrer');
    finishMetric(upstream.status,Date.now()-metricStartedAt);
    const body=req.method==='HEAD'?null:upstream.body;
    const observeLive=type==='live'&&req.method==='GET'&&upstream.status===200&&!out.has('content-length')&&!out.has('content-range')&&!out.has('content-encoding')&&
      /^(?:video\/mp2t|application\/octet-stream)(?:\s*;|$)/i.test(out.get('content-type')||'');
    return new Response(observeLive&&body?observeEdgeBody(body,{signal:req.signal,onFinish:recordEdgeLiveBody}):body,{status:upstream.status,headers:out});
  } catch {
    finishMetric(502,Date.now()-metricStartedAt);
    return response(502,{error:'edge_upstream_unavailable'});
  } finally {
    // A rare error during Response construction must not strand the gauge.
    finishMetric(502,Date.now()-metricStartedAt);
  }
}});
console.info('BLOFY Xtream standalone edge listening on',server.port);

export {server,liveBodyCounts};
