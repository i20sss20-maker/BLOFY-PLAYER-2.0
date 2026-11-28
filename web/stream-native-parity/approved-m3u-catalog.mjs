// Generic M3U catalog parsing, without fetching any URL or retaining credentials.
// The caller supplies explicit provider-approved HTTPS origins. Never turn this
// into an unrestricted server-side proxy. HLS media manifests are not catalogs.
const MAX_BYTES=8*1024*1024,MAX_ENTRIES=20000,MAX_LINE=8192;
const CONTROL=/[\u0000-\u001f\u007f]/;
function fail(code){return Object.assign(new Error(code),{code})}
function approvedUrl(raw,base,origins){
 if(typeof raw!=='string'||raw.length>4096||CONTROL.test(raw)||raw!==raw.trim())return null;
 try{
  const u=new URL(raw,base);
  if(u.protocol!=='https:'||u.username||u.password||u.hash||!origins.has(u.origin))return null;
  return u.href;
 }catch{return null}
}
function splitInfo(line){
 let quoted=false,at=-1;
 for(let i=8;i<line.length;i++){
  if(line[i]==='"')quoted=!quoted;
  else if(line[i]===','&&!quoted){at=i;break}
 }
 if(at<0||quoted)return null;
 const attrs=line.slice(8,at),name=line.slice(at+1).trim().slice(0,240);
 if(!name||CONTROL.test(name))return null;
 const fields=Object.create(null),re=/([a-zA-Z0-9_-]+)="([^"]*)"/g;
 let m;
 while((m=re.exec(attrs))!==null){const key=m[1].toLowerCase();if(!Object.hasOwn(fields,key))fields[key]=m[2].slice(0,512)}
 return {name,group:(fields['group-title']||'').trim().slice(0,120),logo:fields['tvg-logo']||'',tvgId:(fields['tvg-id']||'').slice(0,160)};
}
export function parseApprovedM3u(text,{baseUrl,approvedOrigins,maxEntries=MAX_ENTRIES}={}){
 if(typeof text!=='string'||text.length>MAX_BYTES||new TextEncoder().encode(text).length>MAX_BYTES)throw fail('playlist_too_large');
 const origins=new Set(approvedOrigins||[]);
 if(!origins.size||origins.size>32||!approvedUrl(baseUrl,undefined,origins))throw fail('provider_not_approved');
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
 if(!/^#EXTM3U(?:\s|$)/.test((lines[0]||'').trim()))throw fail('invalid_m3u_header');
 if(lines.some(line=>/^#EXT-X-/i.test(line.trim())))throw fail('hls_is_not_a_catalog');
 const limit=Math.max(1,Math.min(MAX_ENTRIES,Number.isInteger(maxEntries)?maxEntries:MAX_ENTRIES));
 const items=[],seen=new Set();let meta=null,rejected=0;
 for(let i=1;i<lines.length;i++){
  const line=lines[i].trim();
  if(!line)continue;
  if(line.length>MAX_LINE){meta=null;rejected++;continue}
  if(line.startsWith('#EXTINF:')){meta=splitInfo(line);if(!meta)rejected++;continue}
  if(line[0]==='#'){
   // Don't honor VLC/Kodi instructions carrying headers, cookies or DRM data.
   if(/^#(?:EXTVLCOPT|KODIPROP|EXTHTTP|EXT-X-KEY)/i.test(line))meta=null;
   continue
  }
  if(!meta){rejected++;continue}
  const url=approvedUrl(line,baseUrl,origins);
  if(!url){meta=null;rejected++;continue}
  if(!seen.has(url)){
   if(items.length>=limit)throw fail('playlist_entry_limit');
   const logo=meta.logo?approvedUrl(meta.logo,baseUrl,origins):null;
   // URLs may contain subscription credentials; keep the parsed catalog
   // in an isolated transient session. Do not log or persist this object.
   items.push({id:String(items.length+1),name:meta.name,group:meta.group,tvgId:meta.tvgId,logo,url});
   seen.add(url);
  }
  meta=null;
 }
 if(!items.length)throw fail('playlist_no_approved_entries');
 return {items,rejected};
}
