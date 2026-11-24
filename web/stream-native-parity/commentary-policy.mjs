// Sanitize BLOFY's protected audio catalogue for the web. Never expose source URLs.
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const CHANNEL=/^[A-Za-z0-9_-]{1,80}$/;
export function validCommentaryChannel(channel){return CHANNEL.test(String(channel||''))}
export function safeCommentaryUrl(value){
 try{
  const url=new URL(String(value||''));
  return url.protocol==='https:'&&url.hostname==='blofyplayer.com'&&
    !url.username&&!url.password&&url.port===''&&!url.hash&&
    url.pathname.startsWith('/api/v1/stream/media/audio/')&&
    !url.pathname.includes('..')&&value.length<=2048;
 }catch{return false}
}
export function channelTracks(raw,channelId){
 if(!validCommentaryChannel(channelId)||!raw||typeof raw!=='object')return [];
 let entry=raw;
 if(Array.isArray(raw.channels)){
  entry=raw.channels.slice(0,256).find(x=>x&&String(x.channelId)===String(channelId));
  if(!entry)return [];
 }
 if(!Array.isArray(entry.tracks))return [];
 const seen=new Set(),result=[];
 for(const t of entry.tracks.slice(0,64)){
  const id=String(t?.id||''),label=String(t?.label||'').trim();
  if(!ID.test(id)||seen.has(id)||!label||!safeCommentaryUrl(t.playbackUrl))continue;
  seen.add(id);
  result.push({id,label:label.slice(0,80).replace(/\b(?:Anes|Anis)\b/gi,'BLOFY').replace(/أنيس/g,'بلوفي'),
    delaySeconds:Math.max(-30,Math.min(30,Math.trunc(Number(t.delaySeconds)||0))),
    format:String(t.format||'').toLowerCase()==='hls'||new URL(t.playbackUrl).pathname.endsWith('.m3u8')?'hls':'progressive',
    source:String(t.playbackUrl)});
  if(result.length>=60)break;
 }
 return result;
}
export function publicCommentaryTracks(tracks){return tracks.map(({id,label,delaySeconds,format})=>({id,label,delaySeconds,format}))}
