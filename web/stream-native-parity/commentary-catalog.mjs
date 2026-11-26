const idPattern=/^anis-[a-z0-9-]{1,54}$/;
export function validCommentaryId(id){return typeof id==='string'&&idPattern.test(id)}
export function safeCommentaryTracks(data,channel){
 const rows=Array.isArray(data?.channels)?data.channels.slice(0,256).find(x=>x?.channelId===channel)?.tracks:data?.tracks;
 if(!Array.isArray(rows))return [];
 const seen=new Set(),out=[];
 for(const row of rows.slice(0,64)){
  if(!validCommentaryId(row?.id)||seen.has(row.id)||row.format!=='progressive'||row.playbackUrl!=='https://blofyplayer.com/api/v1/stream/media/audio/'+row.id)continue;
  const label=typeof row.label==='string'?row.label.trim().slice(0,80):'';
  if(!label)continue;
  seen.add(row.id);out.push({id:row.id,label,delaySeconds:Math.min(30,Math.max(0,Math.trunc(Number(row.delaySeconds)||0)))});
 }
 return out
}
export async function boundedCommentaryJson(response){
 const reader=response.body?.getReader();if(!reader)throw Error('missing_body');
 const decoder=new TextDecoder();let size=0,raw='';
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144)throw Error('catalog_too_large');raw+=decoder.decode(part.value,{stream:true})}
 return JSON.parse(raw+decoder.decode())}finally{try{await reader.cancel()}catch{}}
}
