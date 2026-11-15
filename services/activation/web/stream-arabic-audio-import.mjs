/**
 * Local-only import preview for operator-provided audio playlists/configuration.
 * Does NOT upload files, auto-add channels, fetch untrusted URLs, or expose
 * credentials. Only explicit HTTPS candidate URLs are passed to the admin form
 * after the operator selects them.
 */
const MAX_FILE_CHARS=1_000_000;
const MAX_CANDIDATES=60;
const AUDIO_EXT=/\.(?:mp3|aac|m4a|ogg|oga|opus|wav|flac)(?:$|[?#])/i;
const VIDEO_EXT=/\.(?:mp4|mkv|avi|webm|ts|m2ts|mov)(?:$|[?#])/i;
const HLS_EXT=/\.m3u8(?:$|[?#])/i;
const LINK_KEYS=new Set(['url','src','href','stream','stream_url','streamurl',
  'audio','audio_url','audiourl','link','playbackurl','file','source']);
const NAME_KEYS=['label','name','title','description','channel','tvg-name'];
const VALID_FILE_TYPES=new Set(['m3u','m3u8','txt','cfg','xml','json']);

function sanitizedUrl(raw){
  if(typeof raw!=='string'||raw.length>1600)return null;
  const value=raw.trim().replace(/^["']|["']$/g,'');
  if(!/^https:\/\//i.test(value)||/[\x00-\x1f]/.test(value))return null;
  let parsed;
  try{parsed=new URL(value)}catch{return null}
  if(parsed.protocol!=='https:'||parsed.port!==''||parsed.username||
     parsed.password||parsed.hash||!parsed.hostname.includes('.'))return null;
  // Protocol-relative, local files, credentials in authority and private IPs
  // are never used by the importer. Backend independently enforces its allowlist.
  if(!/^[a-z0-9.-]+$/i.test(parsed.hostname)||
     /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(parsed.hostname))
    return null;
  return parsed.href;
}
function classification(url){
  if(HLS_EXT.test(url))return 'hls_unavailable';
  if(VIDEO_EXT.test(url))return 'video_not_audio';
  return AUDIO_EXT.test(url)?'audio_candidate':'verify_audio_type';
}
function looksLikeUrl(value){
  return typeof value==='string'&&/^https:\/\//i.test(value.trim());
}
function stripCodeLine(line){
  // URL might carry '=' in its query string, so split only on initial key=value.
  const parsed=/^\s*(?:url|src|href|stream_url|audio_url|audio|stream|link|source)\s*[:=]\s*(.+)$/i.exec(line);
  if(parsed)return parsed[1].trim();
  return line.trim();
}
function playlistRows(text,format,add){
  const lines=text.split(/\r?\n/);
  let label='';
  let hlsManifest=format==='m3u8';
  if(lines.slice(0,80).some(s=>s.startsWith('#EXT-X-')))hlsManifest=true;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line)continue;
    if(line.startsWith('#EXTINF')){
      const match=line.match(/(?:tvg-name|title)="([^"]{1,120})"/i);
      label=(match?.[1]||line.split(',').slice(1).join(',')).trim().slice(0,80);
      continue;
    }
    if(line.startsWith('#'))continue;
    // HLS contains media segments, not a list of separate Arabic audio feeds.
    if(hlsManifest){
      if(looksLikeUrl(line))add(line,label||'HLS', 'hls_unavailable');
      continue;
    }
    const candidate=stripCodeLine(line);
    if(looksLikeUrl(candidate))add(candidate,label||'صوتية من القائمة');
    label='';
  }
}
function structuredJson(text,add){
  let data;
  try{data=JSON.parse(text)}catch{return false}
  let budget=1500;
  const walk=(node,label='',depth=0)=>{
    if(--budget<0||depth>12)return;
    if(Array.isArray(node)){
      for(const item of node.slice(0,100))walk(item,label,depth+1);
      return;
    }
    if(!node||typeof node!=='object')return;
    const ownLabel=NAME_KEYS
      .map(key=>node[key]).find(v=>typeof v==='string'&&v.trim())||label;
    for(const [key,value] of Object.entries(node).slice(0,80)){
      if(LINK_KEYS.has(key.toLowerCase())&&looksLikeUrl(value))
        add(value,ownLabel||'صوتية JSON');
      else if(value&&typeof value==='object')walk(value,ownLabel,depth+1);
    }
  };
  walk(data);
  return true;
}
function structuredXml(text,add){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))return false;
  if(typeof DOMParser==='undefined')return false;
  let document;
  try{document=new DOMParser().parseFromString(text,'application/xml')}catch{return false}
  if(document.querySelector('parsererror'))return false;
  const nodes=document.querySelectorAll('*');
  for(let i=0;i<Math.min(nodes.length,3000);i++){
    const node=nodes[i];
    const label=node.getAttribute('name')||node.getAttribute('title')||
      node.getAttribute('label')||'صوتية XML';
    for(const attr of ['url','src','href','stream','audio','link','playbackUrl']){
      const value=node.getAttribute(attr);
      if(looksLikeUrl(value))add(value,label);
    }
    if(LINK_KEYS.has(node.localName?.toLowerCase()||'')&&
       looksLikeUrl(node.textContent)&&node.children.length===0)
      add(node.textContent,label);
  }
  return true;
}
export function parseArabicAudioImport(content,extension){
  const format=String(extension||'').trim().toLowerCase().replace(/^\./,'');
  if(!VALID_FILE_TYPES.has(format))
    return {error:'unsupported_file_type',entries:[],truncated:false};
  if(typeof content!=='string'||content.length>MAX_FILE_CHARS)
    return {error:'file_too_large',entries:[],truncated:false};
  const seen=new Set(),entries=[];
  let truncated=false;
  const add=(raw,label='',forcedFormat=null)=>{
    if(entries.length>=MAX_CANDIDATES){truncated=true;return}
    const url=sanitizedUrl(raw);
    if(!url||seen.has(url))return;
    seen.add(url);
    const kind=forcedFormat||classification(url);
    if(kind==='video_not_audio')return;
    entries.push({
      label:String(label||'صوتية').replace(/[\x00-\x1f]/g,' ').slice(0,80),
      url,kind,
      selectable:kind!=='hls_unavailable'
    });
  };
  if(format==='json'){
    if(!structuredJson(content,add))
      return {error:'invalid_json',entries:[],truncated:false};
  }else if(format==='xml'){
    if(!structuredXml(content,add))
      return {error:'invalid_xml',entries:[],truncated:false};
  }else{
    playlistRows(content,format,add);
  }
  return {error:null,entries,truncated};
}
