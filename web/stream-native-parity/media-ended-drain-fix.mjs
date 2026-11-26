import {readFileSync,writeFileSync} from 'node:fs';
let source=readFileSync('media-worker.ts','utf8');
function change(a,b){if(source.split(a).length!==2)throw Error('Unexpected worker source');source=source.replace(a,b)}
change("function stopHls(session,reason){\n if(!session||session.stopped)return;","function stopHls(session,reason){\n if(!session||session.stopped)return;\n if(session.finishedDrainTimer){clearTimeout(session.finishedDrainTimer);session.finishedDrainTimer=null}");
change(" if(filename==='index.m3u8'&&kind==='live'&&owner.finished){\n  stopHls(owner,'live_source_finished');\n  return hlsError(503,'hls_source_finished')\n }",` if(filename==='index.m3u8'&&kind==='live'&&owner.finished){
  // Preserve already advertised chunks briefly, without advertising a dead
  // playlist or opening a second source connection. STOP still cancels now.
  if(owner.servedLiveManifest&&!owner.stopped){
   if(!owner.finishedDrainTimer){
    owner.finishedDrainTimer=setTimeout(()=>stopHls(owner,'live_source_finished'),5000);
    owner.finishedDrainTimer.unref?.();
   }
   return hlsError(503,'hls_source_finished',5)
  }
  stopHls(owner,'live_source_finished');
  return hlsError(503,'hls_source_finished',2)
 }`);
change("if(streamed&&kind==='live')noteLiveSourceHealthy(owner);","if(streamed&&kind==='live'&&!owner.finished)noteLiveSourceHealthy(owner);");
change("  if(!data.length)return hlsError(503,'hls_file_empty');\n  return new Response(data,","  if(!data.length)return hlsError(503,'hls_file_empty');\n  if(kind==='live')owner.servedLiveManifest=true;\n  return new Response(data,");

change("const hlsSessions=new Map();",`const hlsSessions=new Map();
// Store only HMAC session keys, never provider credentials. A closed SID
// must not silently create a new sequence-zero playlist under its old URL.
const retiredLiveSids=new Map();
function retireLiveSid(key,now=Date.now()){
 retiredLiveSids.delete(key);retiredLiveSids.set(key,now+180000);
 while(retiredLiveSids.size>4096)retiredLiveSids.delete(retiredLiveSids.keys().next().value)
}
function liveSidRetired(key,now=Date.now()){
 const until=retiredLiveSids.get(key);
 if(!until)return false;
 if(until<=now){retiredLiveSids.delete(key);return false}
 return true
}`);
change(" if(!session||session.stopped)return;\n if(session.finishedDrainTimer)"," if(!session||session.stopped)return;\n if(session.kind==='live'&&session.viewerSid&&(session.servedLiveManifest||session.sharedProducer?.servedLiveManifest))retireLiveSid(session.key);\n if(session.finishedDrainTimer)");
change("  const activeSession=hlsSessions.get(key);\n  if(activeSession)stopHls(activeSession,'viewer_stopped');","  if(stop[1]==='live'&&stop[5])retireLiveSid(key);\n  const activeSession=hlsSessions.get(key);\n  if(activeSession)stopHls(activeSession,'viewer_stopped');");
change(" let sess=hlsSessions.get(key);\n if(!sess&&filename!=='index.m3u8')"," let sess=hlsSessions.get(key);\n if(!sess&&kind==='live'&&viewerSid&&liveSidRetired(key))return hlsError(filename==='index.m3u8'?503:404,'hls_session_retired',2);\n if(!sess&&filename!=='index.m3u8')");
change(" const owner=sess.sharedProducer||sess;\n touchHls(sess);"," if(kind==='live'&&viewerSid){\n  if(liveSidRetired(key)){if(!sess.stopped)stopHls(sess,'viewer_stopped');return hlsError(503,'hls_session_retired',2)}\n  sess.viewerSid=viewerSid\n }\n const owner=sess.sharedProducer||sess;\n touchHls(sess);");


// The worker now implements admission handling directly. Keep this legacy
// build script responsible only for drain and retired-SID compatibility.

writeFileSync('media-worker.ts',source);
