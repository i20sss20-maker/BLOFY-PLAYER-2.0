import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';

const token='T'.repeat(40);
const runId='demo_run_20261113';
const key='saleh/movie/9adc6472-5d4e-4359-83e4-0298cc038ae3/pilot_123456789.mkv';

test('verified movie canary serves only admin-authenticated, bounded private byte ranges',async()=>{
 const calls=[];
 const storage={
  health:async()=>({ok:true}),
  readVerifiedRange:async(arg)=>{
   calls.push(arg);
   return Readable.from([Buffer.from('ABCD')]);
  }
 };
 const lease={
  health:async()=>true,
  getVerifiedPilotObject:async(id)=>id===runId?{key,bytes:16}:null,
  getPilotStatus:async()=>null,
  listPilotRuns:async()=>[],
  storageAccounting:async()=>({verifiedCount:0,verifiedBytes:0,
    activeCount:0,failedCount:0,scope:'verified_pilot_records_only'})
 };
 const hub=createContentHubServer({storage,lease,token});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const base='http://127.0.0.1:'+hub.server.address().port;
  const route='/internal/pilot/playback/'+runId;
  const unauthed=await fetch(base+route,{headers:{range:'bytes=0-3'}});
  assert.equal(unauthed.status,401);
  const headers={authorization:'Bearer '+token};
  const noRange=await fetch(base+route,{headers});
  assert.equal(noRange.status,416);
  const wrong=await fetch(base+route,{headers:{...headers,range:'bytes=0-99'}});
  assert.equal(wrong.status,416);
  const valid=await fetch(base+route,{headers:{...headers,range:'bytes=0-3'}});
  assert.equal(valid.status,206);
  assert.equal(valid.headers.get('content-range'),'bytes 0-3/16');
  assert.equal(valid.headers.get('cache-control'),'private,no-store');
  assert.equal(await valid.text(),'ABCD');
  assert.equal(calls.length,1);
  assert.equal(calls[0].from,0);
  assert.equal(calls[0].to,3);
  assert.equal(calls[0].expectedBytes,16);
  const health=await fetch(base+'/health');
  assert.equal(health.status,200);
  const status=await fetch(base+'/internal/status',{headers});
  assert.equal(status.status,200);
  assert.equal((await status.json()).customerCutover,false);
  const pilots=await fetch(base+'/internal/pilots',{headers});
  assert.equal(pilots.status,200);
  assert.equal((await pilots.json()).accounting.verifiedCount,0);
  const stopped=await fetch(base+'/internal/pilot/cancel',{
    method:'POST',headers});
  assert.equal(stopped.status,409);
  const signal=hub.startPilot();
  assert.equal(signal.aborted,false);
  const cancellation=await fetch(base+'/internal/pilot/cancel',{
    method:'POST',headers});
  assert.equal(cancellation.status,202);
  assert.equal(signal.aborted,true);
  hub.recordPilot({ok:false,code:'pilot_cancelled',stored:false});
 }finally{
  await new Promise(resolve=>hub.server.close(resolve));
 }
});
