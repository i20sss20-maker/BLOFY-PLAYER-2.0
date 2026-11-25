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
writeFileSync('media-worker.ts',source);
