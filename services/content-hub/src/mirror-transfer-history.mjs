// Owner-only durable transfer history. Existing pilot and season workers have
// separate run prefixes; never mix them into the licensed mirror totals.
const RUN=/^mirror_[a-f0-9]{32}$/;
const base={privateOnly:true,readOnly:true,customerCutover:false,
 automaticDownload:false,providerRequests:0,mediaBytesTransferred:0};
export function summarizeMirrorHistory(rows=[],{limit=24}={}){
 if(!Number.isInteger(limit)||limit<1||limit>50)
  return {...base,ok:false,code:'mirror_history_limit_invalid'};
 const items=rows.filter(x=>RUN.test(String(x?.runId||'')))
  .map(x=>{
   const expected=Number(x.expectedBytes),copied=Number(x.bytesCopied);
   const bytes=Number.isSafeInteger(expected)&&expected>0?expected:0;
   const saved=Number.isSafeInteger(copied)&&copied>=0?copied:0;
   const complete=x.state==='verified'&&saved===bytes;
   return {kind:x.mediaKind==='episode'?'episode':'movie',
    runId:String(x.runId),state:['staged','verified','failed'].includes(x.state)?
      x.state:'unknown',
    completed:complete,expectedBytes:bytes,bytesCopied:Math.min(saved,bytes),
    percent:bytes?Math.floor(Math.min(saved,bytes)*100/bytes):0,
    partsCopied:Number.isSafeInteger(Number(x.partsCopied))?
     Math.max(0,Number(x.partsCopied)):0,
    failureCode:/^[a-z0-9_]{1,80}$/.test(String(x.code||''))?
     String(x.code):null,
    startedAt:x.startedAt||null,
    finishedAt:x.finishedAt||null
   }
  })
  .sort((a,b)=>new Date(b.startedAt||0).getTime()-
    new Date(a.startedAt||0).getTime()).slice(0,limit);
 const counts={verified:0,staged:0,failed:0,other:0};
 let saved=0,verifiedBytes=0;
 for(const item of items){
  if(item.state==='verified'&&item.completed)counts.verified++;
  else if(item.state==='staged')counts.staged++;
  else if(item.state==='failed')counts.failed++;
  else counts.other++;
  saved+=item.bytesCopied;
  if(item.completed)verifiedBytes+=item.expectedBytes;
 }
 return {...base,ok:true,code:'mirror_history_private_read_only',
  items,counts,storedBytes:saved,verifiedBytes,
  itemCount:items.length,physicalS3CurrentlyChecked:false,
  subscriberPlaybackVerified:false};
}
export async function readMirrorHistory(lease,{limit=24}={}){
 if(!lease?.listChunkedRuns||!lease?.listEpisodeRuns)
  return {...base,ok:false,code:'mirror_history_dependency_missing'};
 try{
  // No provider calls, S3 GETs, or private object keys.
  const [movies,episodes]=await Promise.all([
   lease.listChunkedRuns({limit:50}),lease.listEpisodeRuns({limit:25})
  ]);
  return summarizeMirrorHistory([
   ...movies.map(x=>({...x,mediaKind:'movie'})),...episodes
  ],{limit});
 }catch{return {...base,ok:false,code:'mirror_history_unavailable'}}
}
