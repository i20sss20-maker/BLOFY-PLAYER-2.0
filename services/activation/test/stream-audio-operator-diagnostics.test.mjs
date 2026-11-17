import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamAudioOperatorDiagnostics} from '../src/stream-audio-operator-diagnostics.mjs';

function fixture(){
 let calls=0,at=1_000_000;
 const bridge={
  catalog:()=>({status:200,body:{tracks:[
   {id:'anis-max-2',label:'Anis Max 2',playbackUrl:'private-source-url'},
   {id:'anis-sport-4',label:'Anis Sport 4',playbackUrl:'private-source-token'}
  ]}}),
  probe:async ids=>{
   calls++;
   return ids.map(id=>({
    id,reason:'audio_bytes_detected',payloadClass:'audio_packet',
    receivedBytes:377,token:'MUST_NEVER_LEAK',url:'http://secret.source',
    errorCode:'ECONNRESET'
   }));
  }
 };
 return {bridge,now:()=>at,advance:ms=>{at+=ms},calls:()=>calls};
}
test('readiness is side-effect free, returning IDs only without source URLs',()=>{
 const f=fixture(),svc=createStreamAudioOperatorDiagnostics(f);
 const r=svc.readiness();
 assert.equal(r.status,200);
 assert.equal(r.body.configured,true);
 assert.equal(r.body.tracks.length,2);
 assert.equal(r.body.noProbeOnRead,true);
 assert.equal(f.calls(),0);
 assert.doesNotMatch(JSON.stringify(r.body),/private-source|token|secret/i);
});
test('manual probe requires catalog-known IDs, enforces 2 max and cooldown',async()=>{
 const f=fixture(),svc=createStreamAudioOperatorDiagnostics(f);
 for(const ids of [[],['anis-unknown-1'],['anis-max-2','anis-max-2'],
  ['anis-max-2','anis-sport-4','anis-max-1'],null]){
  assert.equal((await svc.probe(ids)).status,400);
 }
 assert.equal(f.calls(),0);
 const r=await svc.probe(['anis-max-2','anis-sport-4']);
 assert.equal(r.status,200);
 assert.equal(r.body.results.length,2);
 assert.equal(r.body.results[0].progressiveAudioDetected,true);
 assert.equal(r.body.mediaPlaybackVerified,false);
 assert.equal(r.body.sourceBytesStored,false);
 assert.doesNotMatch(JSON.stringify(r.body),/MUST_NEVER|secret\.source|ECONNRESET/);
 assert.equal(f.calls(),1);
 const again=await svc.probe(['anis-max-2']);
 assert.equal(again.status,429);
 assert.equal(again.body.code,'audio_probe_cooldown');
 assert.equal(f.calls(),1);
 f.advance(120001);
 assert.equal((await svc.probe(['anis-max-2'])).status,200);
 assert.equal(f.calls(),2);
});
test('in-flight probe cannot launch duplicate provider requests',async()=>{
 const f=fixture();let release;
 f.bridge.probe=()=>new Promise(resolve=>{release=resolve});
 const svc=createStreamAudioOperatorDiagnostics(f);
 const pending=svc.probe(['anis-max-2']);
 assert.equal((await svc.probe(['anis-max-2'])).body.code,'audio_probe_busy');
 release([{reason:'unrecognized_stream_bytes',payloadClass:'unknown_binary',
  receivedBytes:4096}]);
 const result=await pending;
 assert.equal(result.status,200);
 assert.equal(result.body.results[0].progressiveAudioDetected,false);
});
test('disabled sources cannot be probed',async()=>{
 let called=0;
 const svc=createStreamAudioOperatorDiagnostics({
  bridge:{catalog:()=>({status:503,body:{ok:false}}),
   probe:async()=>{called++;return []}}
 });
 assert.equal(svc.readiness().body.configured,false);
 assert.equal((await svc.probe(['anis-max-2'])).status,400);
 assert.equal(called,0);
});
