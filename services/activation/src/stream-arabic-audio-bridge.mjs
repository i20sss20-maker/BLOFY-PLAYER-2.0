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

export function parseOperatorAudioPlaylist(raw) {
  if(typeof raw!=='string'||raw.length>25000)return [];
  let values;
  try {values=JSON.parse(raw)?.playlist;}catch{return [];}
  if(!Array.isArray(values)||values.length>MAX_SOURCES)return [];
  const taken=new Set(),result=[];
  for(const row of values){
    const label=String(row?.channel||'').trim();
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!AUDIO_ID.test(id)||taken.has(id)||label.length>80)continue;
    const rawUrl=String(row?.url||'').trim();
    if(rawUrl.length<20||rawUrl.length>1200)continue;
    let url;
    try{url=new URL(rawUrl);}catch{continue;}
    // Intentional one-origin radio allowlist; never turn this into an open
    // HTTP proxy. External sources are operator-vetted, not customer-supplied.
    if(url.protocol!=='http:'||url.hostname!==LIVE_HOST||
       (url.port&&url.port!=='80')||url.username||url.password||
       !/^\/live\/[a-z0-9_-]{1,28}\/[0-9]{1,4}$/i.test(url.pathname)||
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
          lookup(_host,_opts,callback){callback(null,address.address,address.family);}
        },audio=>{
          if(![200,206].includes(audio.statusCode)){
            audio.resume();
            errorResponse(res,502,'audio_source_unavailable');return finish();
          }
          const type=String(audio.headers['content-type']||'audio/mpeg')
            .split(';')[0].trim().toLowerCase();
          if(!/^audio\/(mpeg|mp3|aac|aacp|ogg|opus|x-aac|x-mpegurl)$/.test(type)&&
             type!=='application/octet-stream'){
            audio.resume();
            errorResponse(res,415,'unsupported_audio_format');return finish();
          }
          res.writeHead(audio.statusCode,{
            'content-type':type==='application/octet-stream'?'audio/mpeg':type,
            'cache-control':'no-store, private',
            'x-content-type-options':'nosniff','accept-ranges':'none',
            'referrer-policy':'no-referrer'
          });
          if(req.method==='HEAD'){audio.destroy();res.end();return finish();}
          audio.pipe(res);
          audio.once('end',finish);
          audio.once('error',()=>{res.destroy();finish();});
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
  return {catalog,stream};
}

function errorResponse(res,status,message) {
  if(res.headersSent||res.destroyed)return;
  const body=JSON.stringify({ok:false,error:message});
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),'cache-control':'no-store',
    'x-content-type-options':'nosniff'});
  res.end(body);
}
