import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
import {validateSeasonPriority} from '../src/season-queue.mjs';
import {buildSeasonReport} from '../src/season-report.mjs';

const token='q'.repeat(48);
const runId='season_1234567890abcdef12345678';
test('priority values are strict numeric enum, never arbitrary client strings',()=>{
 for(const n of [0,1,2])assert.equal(validateSeasonPriority(n),n);
 for(const invalid of [-1,3,'2','0',null,1.4,Infinity])
  assert.throws(()=>validateSeasonPriority(invalid),/season_priority_invalid/);
});
test('season report includes measured active time but never guesses missing samples',()=>{
 const report=buildSeasonReport({page:{seasonKey:'series_12_s1',number:1,pages:1},
  totals:{episode_count:'1',expected_bytes:'8388608',stored_bytes:'8388608'},
  episodes:[{runId,episodeNumber:1,state:'paused',priority:2,
   expectedBytes:8388608,storedBytes:8388608}],
  timing:{sample_count:'2',active_ms:'20000',measured_bytes:'8388608',
   first_measured_at:'2026-11-14T08:00:00Z'}});
 assert.equal(report.episodes[0].priority,2);
 assert.equal(report.episodes[0].priorityEditable,true);
 assert.equal(report.transferTiming.measuredActiveMs,20000);
 assert.equal(report.transferTiming.averageBytesPerSecond,419430);
 assert.equal(buildSeasonReport().transferTiming.measuredActiveMs,null);
 assert.equal(report.providerMediaRequests,0);
});
test('private preview and reprioritization demand token and exact signed owner intent',async()=>{
 let changed=0,previewed=0;
 const store={
  resumePreview:async()=>{previewed++;return {
   items:[{runId,seasonKey:'series_12_s1',episodeNumber:1,
    state:'paused',storedBytes:8388608,expectedBytes:16777216,
    databaseSnapshotOnly:true}],
   limited:false,requiresOperatorStart:true,automaticStart:false,
   sourceProbePerformed:false,needsFreshMappingValidation:true};},
  setPriority:async({runId:id,priority})=>{
   changed++;return {ok:true,code:'season_priority_saved',
    runId:id,priority,checkpointUnchanged:true,automaticStart:false}}
 };
 const hub=createContentHubServer({token,seasonQueueStore:store,storage:{},lease:{}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const base='http://127.0.0.1:'+hub.server.address().port;
 const preview=base+'/internal/seasons/resume/preview';
 const priority=base+'/internal/seasons/priority';
 const auth={authorization:'Bearer '+token};
 const headers={...auth,'content-type':'application/json',
  'x-blofy-season-confirm':'owner-reorder-pending'};
 const good=JSON.stringify({confirmed:true,runId,priority:2});
 try{
  assert.equal((await fetch(preview)).status,401);
  assert.equal((await fetch(preview+'?x=1',{headers:auth})).status,400);
  const inspected=await fetch(preview,{headers:auth});
  assert.equal(inspected.status,200);
  const data=await inspected.json();
  assert.equal(data.readOnly,true);
  assert.equal(data.automaticStart,false);
  assert.equal(data.providerMediaRequests,0);
  assert.equal(data.items[0].databaseSnapshotOnly,true);
  assert.equal(previewed,1);
  assert.equal((await fetch(priority,{method:'POST',body:good})).status,401);
  assert.equal((await fetch(priority,{method:'POST',headers:{
   ...auth,'content-type':'application/json'},body:good})).status,403);
  assert.equal((await fetch(priority,{method:'POST',headers,
   body:JSON.stringify({confirmed:false,runId,priority:2})})).status,400);
  assert.equal((await fetch(priority,{method:'POST',headers,
   body:JSON.stringify({confirmed:true,runId,priority:'2'})})).status,400);
  assert.equal((await fetch(priority+'?x=1',{method:'POST',
   headers,body:good})).status,403);
  assert.equal(changed,0);
  const accepted=await fetch(priority,{method:'POST',headers,body:good});
  assert.equal(accepted.status,200);
  const saved=await accepted.json();
  assert.equal(saved.automaticStart,false);
  assert.equal(saved.checkpointUnchanged,true);
  assert.equal(changed,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
