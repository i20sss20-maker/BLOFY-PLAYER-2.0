import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuousCopyController} from '../src/continuous-copy.mjs';
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));

test('one operator start processes stored chunks until movie is verified',async()=>{
 let chunks=0;
 const c=createContinuousCopyController({
  readiness:()=>({ready:true,blockedBy:[]}),
  pause:async()=>{},delayMs:0,
  runBatch:async()=>{
   chunks++;
   return chunks===3?{ok:true,code:'batch_movie_fully_verified',
       completed:true,bytes:3*8388608}:
     {ok:true,code:'batch_checkpoint_saved',bytesCopied:chunks*8388608};
  }
 });
 assert.equal(c.start().ok,true);
 assert.equal(c.start().code,'copy_already_running');
 await settle();
 assert.equal(chunks,3);
 assert.equal(c.status().state,'completed');
 assert.equal(c.status().active,false);
 assert.equal(c.status().bytesCopied,3*8388608);
});
test('copy does not start without all safety gates, or retry a failing source',async()=>{
 let requests=0,allowed=false;
 const c=createContinuousCopyController({
  readiness:()=>({ready:allowed,blockedBy:['source_idle_unconfirmed']}),
  pause:async()=>{},delayMs:0,
  runBatch:async()=>{
   requests++;
   return {ok:false,code:'batch_retryable_error',errorStage:'source_chunk'};
  }
 });
 assert.equal(c.start().code,'copy_safety_gates_off');
 assert.equal(requests,0);
 allowed=true;
 assert.equal(c.start().ok,true);
 await settle();
 assert.equal(requests,1);
 assert.equal(c.status().state,'failed');
 assert.equal(c.status().code,'batch_retryable_error');
 assert.equal(c.status().errorStage,'source_chunk');
});
test('operator can stop a running source before next chunk',async()=>{
 let requests=0;
 const c=createContinuousCopyController({
  readiness:()=>({ready:true,blockedBy:[]}),delayMs:0,pause:async()=>{},
  runBatch:async({signal})=>{
   requests++;
   if(requests===1)return {ok:true,code:'batch_checkpoint_saved',
       bytesCopied:8388608};
   await new Promise(resolve=>setTimeout(resolve,30));
   return signal.aborted?{ok:false,code:'batch_cancelled'}:
     {ok:true,code:'batch_checkpoint_saved',bytesCopied:16777216};
  }
 });
 assert.equal(c.start().ok,true);
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(c.stop().ok,true);
 await new Promise(resolve=>setTimeout(resolve,55));
 assert.equal(c.status().active,false);
 assert.equal(c.status().state,'paused');
 assert.equal(c.status().code,'copy_stopped_by_operator');
});

test('episode continuous controller checkpoints each part and stops at verified episode',async()=>{
 let parts=0;
 const c=createContinuousCopyController({
  readiness:()=>({ready:true,blockedBy:[]}),
  pause:async()=>{},delayMs:0,maxBatches:5,
  runBatch:async()=>{
   parts++;
   return parts===3?{ok:true,code:'episode_fully_verified',
      completed:true,bytes:3*8388608}:
      {ok:true,code:'episode_checkpoint_saved',
       bytesCopied:parts*8388608};
  }
 });
 assert.equal(c.start().ok,true);
 await settle();
 assert.equal(parts,3);
 assert.equal(c.status().state,'completed');
 assert.equal(c.status().active,false);
 assert.equal(c.status().bytesCopied,3*8388608);
});
