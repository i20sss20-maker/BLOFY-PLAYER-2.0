// BLOFY STREAM opt-in, authenticated Arabic audio relay.
// Operator-configured licensed sources remain ONLY in the server environment.
// No third-party source URL/token is returned to an APK or written to logs.
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';

const LIVE_HOST='radio.anisfm.vip';
const AUDIO_ID=/^anis-[a-z0-9-]{1,54}$/;
const MAX_SOURCES=40;
const MAX_ACTIVE_PER_ACCOUNT=3;

function publicAddress(ip) {
  if(net.isIP(ip)===4) {
    const p=ip.split('.').map(Number);
    if(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||
       (p[0]===100&&p[1]>=64&&p[1]<=127)||
       (p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||
       (p[0]===192&&p[1]===168)||(p[0]===198&&p[1]===18))return false;
    return true;
  }
  if(net.isIP(ip)===6){
    const v=ip.toLowerCase();
    if(v==='::1'||v==='::'||v.startsWith('fe80:')||
       v.startsWith('fc')||v.startsWith('fd'))return false;
    if(v.startsWith('::ffff:'))return publicAddress(v.slice(7));
    return true;
  }
  return false;
}

/** Node 22/24 may request DNS autoSelectFamily with `options.all=true`,
 * which requires an ARRAY of address records, not the legacy string+family.
 * Using a string there raises ERR_INVALID_IP_ADDRESS and all media returns 502.
 * DNS is still resolved and public-validated before this pinned lookup.
 */
/**
 * Recognize real audio packets; many radio upstreams wrongly declare
 * text/plain, application/octet-stream or no content-type at all.
 * Never trust a 200 header without media bytes: prevents HTML error pages
 * from being forwarded to a playback decoder as MP3.
 */
export function sniffFirstAudioMime(sample) {
  const b=Buffer.isBuffer(sample)?sample:Buffer.from(sample||[]);
  if(b.length>=3&&b.subarray(0,3).toString('ascii')==='ID3')return 'audio/mpeg';
  if(b.length>=4&&b.subarray(0,4).toString('ascii')==='OggS')return 'audio/ogg';
  if(b.length>=4&&b.subarray(0,4).toString('ascii')==='fLaC')return 'audio/flac';
  if(b.length>=3&&b[0]===0xff&&(b[1]&0xf6)===0xf0)
    return 'audio/aac';
  if(b.length>=3&&b[0]===0xff&&(b[1]&0xe0)===0xe0)
    return 'audio/mpeg';
  if(b.length>=377&&b[0]===0x47&&b[188]===0x47&&b[376]===0x47)
    return 'video/mp2t';
  return null;
}

export function pinnedAudioLookup(address) {
  return (_host, options, callback) => {
    if(typeof options==='function') {callback=options;options={};}
    if(options?.all){
      callback(null,[{address:address.address,family:address.family}]);
    }else{
      callback(null,address.address,address.family);
    }
  };
}

export function parseOperatorAudioPlaylist(raw) {
  if(typeof raw!=='string'||raw.length>25000)return [];
  let values;
  try {values=JSON.parse(raw)?.playlist;}catch{return [];}
  if(!Array.isArray(values)||values.length>MAX_SOURCES)return [];
  const taken=new Set(),result=[];
  for(const row of values){
    const label=String(row?.channel||'').trim();
    const normalized=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    // Real operator playlist uses "Anis Max 1 Low" and "Anis Al Kass 1".
    // Canonicalize those to stable IDs expected by the Android groups.
    const id=normalized.replace(/^anis-max-([1-6])-low$/, 'anis-max-low-$1')
      .replace(/^anis-al-kass-/, 'anis-alkass-');
    if(!AUDIO_ID.test(id)||taken.has(id)||label.length>80)continue;
    const rawUrl=String(row?.url||'').trim();
    if(rawUrl.length<20||rawUrl.length>1200)continue;
    let url;
    try{url=new URL(rawUrl);}catch{continue;}
    // Intentional one-origin radio allowlist; never turn this into an open
    // HTTP proxy. External sources are operator-vetted, not customer-supplied.
    if(url.protocol!=='http:'||url.hostname!==LIVE_HOST||
       (url.port&&url.port!=='80')||url.username||url.password||
       !/^\/live\/[a-z0-9_-]{1,28}\/[a-z0-9_-]{1,12}$/i.test(url.pathname)||
       !url.searchParams.has('token'))continue;
    url.hash='';
    taken.add(id);
    result.push(Object.freeze({id,label,url:url.toString()}));
  }
  return result;
}

export function createProtectedArabicAudioBridge({
    getPlaylist=()=>process.env.BLOFY_STREAM_ARABIC_AUDIO_PLAYLIST_JSON,
    isEnabled=()=>process.env.BLOFY_STREAM_ARABIC_AUDIO_ENABLED==='1',
    lookup=dns.lookup,createRequest=http.request
}={}){
  const active=new Map();
  function entries() {
    if(!isEnabled())return [];
    return parseOperatorAudioPlaylist(getPlaylist());
  }
  function catalog() {
    const rows=entries();
    if(!rows.length)return {status:503,body:{ok:false,error:'stream_audio_not_configured'}};
    return {status:200,body:{
      tracks:rows.map(row=>({
        id:row.id,label:row.label,format:'progressive',delaySeconds:0,
        playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/'+row.id
      }))
    }};
  }

  async function stream(req,res,trackId,accountId) {
    const rows=entries();
    if(!rows.length) return errorResponse(res,503,'stream_audio_not_configured');
    const selected=rows.find(row=>row.id===trackId);
    if(!selected)return errorResponse(res,404,'stream_audio_unknown_track');
    const account=String(accountId||'').slice(0,80);
    if(!account)return errorResponse(res,401,'unauthorized');
    const count=active.get(account)||0;
    if(count>=MAX_ACTIVE_PER_ACCOUNT)return errorResponse(res,429,'audio_connection_limit');
    active.set(account,count+1);
    const release=()=>{
      const left=(active.get(account)||1)-1;
      if(left>0)active.set(account,left);else active.delete(account);
    };
    try {
      const upstream=new URL(selected.url);
      // Resolve and pin the radio host's public address before the HTTP request.
      // DNS rebinding to localhost/private Railway networks must not be possible.
      const resolved=await lookup(LIVE_HOST,{all:true});
      const address=resolved.find(x=>publicAddress(x.address));
      if(!address)return errorResponse(res,502,'audio_source_unavailable');
      await new Promise(done=>{
        let finished=false;
        const finish=()=>{if(finished)return;finished=true;done();};
        const headers={'accept':'audio/*,*/*;q=0.4',
          'user-agent':'BLOFY-STREAM-Audio-Relay/1.0'};
        const range=String(req.headers.range||'');
        if(/^bytes=[0-9]+-[0-9]*$/.test(range))headers.range=range;
        const source=createRequest({
          protocol:'http:',hostname:LIVE_HOST,port:80,
          path:upstream.pathname+upstream.search,
          method:req.method==='HEAD'?'HEAD':'GET',
          headers,timeout:7000,agent:false,
          lookup:pinnedAudioLookup(address)
        },audio=>{
          if(![200,206].includes(audio.statusCode)){
            audio.resume();
            errorResponse(res,502,'audio_source_unavailable');return finish();
          }
          const headersFor=mime=>({
            'content-type':mime,
            'cache-control':'no-store, private',
            'x-content-type-options':'nosniff','accept-ranges':'none',
            'referrer-policy':'no-referrer'
          });
          if(req.method==='HEAD'){
            res.writeHead(audio.statusCode,headersFor('application/octet-stream'));
            audio.destroy();res.end();return finish();
          }
          // Do NOT trust the upstream Content-Type; its live station feeds
          // can contain valid MP3/AAC packets with a generic MIME header.
          // Also do NOT forward HTML login/errors that masquerade as HTTP 200.
          let prefix=Buffer.alloc(0);
          let forwarding=false;
          const sniff=chunk=>{
            audio.pause();
            prefix=Buffer.concat([prefix,chunk]);
            const mime=sniffFirstAudioMime(prefix);
            if(mime){
              forwarding=true;
              audio.removeListener('data',sniff);
              res.writeHead(audio.statusCode,headersFor(mime));
              res.write(prefix);
              prefix=Buffer.alloc(0);
              audio.pipe(res);
              audio.resume();
            }else if(prefix.length>=4096){
              audio.removeListener('data',sniff);
              errorResponse(res,415,'upstream_did_not_return_audio');
              audio.destroy();
              finish();
            }else audio.resume();
          };
          audio.on('data',sniff);
          audio.once('end',()=>{
            if(!forwarding)errorResponse(res,415,'upstream_did_not_return_audio');
            else if(!res.writableEnded)res.end();
            finish();
          });
          audio.once('error',()=>{
            if(!res.headersSent)errorResponse(res,502,'audio_source_read_failed');
            else if(!res.writableEnded)res.destroy();
            finish();
          });
        });
        source.on('timeout',()=>source.destroy());
        source.once('error',()=>{
          if(!res.headersSent)errorResponse(res,502,'audio_source_unavailable');
          else res.destroy();
          finish();
        });
        res.once('close',()=>{source.destroy();finish();});
        source.end();
      });
    }catch{
      if(!res.headersSent)errorResponse(res,502,'audio_source_unavailable');
      else res.destroy();
    }finally{release();}
  }

  /**
   * Private, bounded operator-only connectivity check. Never log or return
   * upstream URLs, query tokens, IP addresses, HTTP response bodies or
   * authentication headers. Does not bypass upstream access restrictions.
   */
  async function probe(ids=['anis-max-1','anis-alkass-1']) {
    const rows=entries();
    if(!rows.length)return [{reason:'audio_disabled_or_unconfigured'}];
    let addresses;
    try{addresses=await lookup(LIVE_HOST,{all:true});}
    catch{return [{reason:'dns_lookup_failed'}];}
    const address=addresses.find(x=>publicAddress(x.address));
    if(!address)return [{reason:'no_public_dns_address'}];
    const results=[];
    for(const id of ids.slice(0,2)) {
      const row=rows.find(x=>x.id===id);
      if(!row){results.push({id,reason:'track_not_in_catalog'});continue;}
      const upstream=new URL(row.url);
      const item=await new Promise(resolve=>{
        let settled=false,client;
        const timer=setTimeout(()=>{
          client?.destroy();
          finish({id,reason:'upstream_timeout'});
        },5_500);
        function finish(value){
          if(settled)return;
          settled=true;
          clearTimeout(timer);
          resolve(value);
        }
        try {
          client=createRequest({
            protocol:'http:',hostname:LIVE_HOST,port:80,
            path:upstream.pathname+upstream.search,method:'GET',
            timeout:5_000,agent:false,
            headers:{'accept':'audio/*,*/*;q=0.4',
              'user-agent':'BLOFY-STREAM-Audio-Relay/1.0'},
            lookup:pinnedAudioLookup(address)
          },response=>{
            const status=Number(response.statusCode)||0;
            const rawType=String(response.headers['content-type']||'').toLowerCase();
            const mime=/^(audio\/[a-z0-9.+-]+|application\/(octet-stream|vnd.apple.mpegurl|x-mpegurl|mpegurl))\b/
              .exec(rawType)?.[1]||'other';
            if(status!==200&&status!==206){
              response.destroy();
              finish({id,reason:'upstream_http_status',httpStatus:status});
              return;
            }
            response.once('data',chunk=>{
              response.destroy();
              const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk||'');
              const first=bytes.length>0?bytes[0]:-1;
              const good=bytes.length>2&&(
                bytes.subarray(0,3).toString('ascii')==='ID3'||
                bytes.subarray(0,4).toString('ascii')==='OggS'||
                (first===0xff&&(bytes[1]&0xe0)===0xe0)||
                (first===0x47&&bytes.length>188&&bytes[188]===0x47)
              );
              // Classification is deliberately coarse and content-free.
              // The source can answer 200 with an HTML login/error page
              // or an HLS index, neither is a progressive MP3 stream.
              const prefix=bytes.subarray(0,96).toString('utf8')
                .trimStart().toLowerCase();
              const payloadClass=good?'audio_packet':
                prefix.startsWith('#extm3u')?'hls_playlist':
                prefix.startsWith('<!doctype')||prefix.startsWith('<html')?
                  'html_document':
                prefix.startsWith('{')||prefix.startsWith('[')?'json_document':
                prefix.startsWith('icy ')?'icy_header':
                prefix.startsWith('<?xml')?'xml_document':
                /^[\x20-\x7e\r\n\t]{16,}$/.test(prefix.slice(0,64))?
                  'text_response':'unknown_binary';
              finish({id,reason:good?'audio_bytes_detected':'unrecognized_stream_bytes',
                mime,payloadClass,receivedBytes:Math.min(bytes.length,4096)});
            });
            response.once('end',()=>finish({id,reason:'empty_stream',mime}));
            response.once('error',()=>finish({id,reason:'upstream_read_error',mime}));
          });
          client.once('timeout',()=>{client.destroy();finish({id,reason:'upstream_timeout'});});
          client.once('error',err=>{
            const rawCode=String(err?.code||'').toUpperCase();
            // Only print a strictly filtered *error identifier*, not a
            // potentially credential-bearing error.message or cause.
            const code=/^(?:E[A-Z0-9_]{2,35}|ERR_[A-Z0-9_]{2,45})$/.test(rawCode)
              ?rawCode:'UNKNOWN';
            const reason=['ENOTFOUND','EAI_AGAIN'].includes(code)?'upstream_dns_failed':
              ['ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH',
                'ETIMEDOUT','EACCES','EPERM'].includes(code)?
                'upstream_connection_failed':'upstream_request_failed';
            finish({id,reason,errorCode:code,ipFamily:address.family});
          });
          client.end();
        }catch{finish({id,reason:'upstream_request_failed'});}
      });
      results.push(item);
    }
    return results;
  }
  return {catalog,stream,probe};

}

function errorResponse(res,status,message) {
  if(res.headersSent||res.destroyed)return;
  const body=JSON.stringify({ok:false,error:message});
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),'cache-control':'no-store',
    'x-content-type-options':'nosniff'});
  res.end(body);
}
