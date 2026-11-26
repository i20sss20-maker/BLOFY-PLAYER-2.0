import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticHandoffQa} from '../src/blofy-engine-synthetic-handoff-qa.mjs';
const proof=(engineId,operation,status)=>({engineId,operation,status,scope:'synthetic-only',verified:true});
test('only one synthetic engine runs and verified stop precedes handoff',()=>{
 const qa=createSyntheticHandoffQa();
 assert.deepEqual(qa.next(),{engineId:'hostbrr',operation:'qa-start'});
 assert.equal(qa.acknowledge(proof('hostbrr','qa-start','synthetic_hls_ready')),true);
 assert.equal(qa.acknowledge(proof('linode','qa-start','synthetic_hls_ready')),false);
 assert.equal(qa.acknowledge(proof('hostbrr','qa-stop','unknown')),false);
 assert.equal(qa.acknowledge(proof('hostbrr','qa-stop','synthetic_stopped')),true);
 assert.equal(qa.acknowledge(proof('linode','qa-start','synthetic_hls_ready')),true);
 assert.equal(qa.acknowledge(proof('linode','qa-stop','synthetic_stopped')),true);
 assert.equal(qa.next(),null);assert.equal(qa.snapshot().state,'passed');
});
test('uncertain outcome holds; missing proof or real source scope rejected',()=>{
 const qa=createSyntheticHandoffQa();
 const p=proof('hostbrr','qa-start','synthetic_hls_ready');
 assert.equal(qa.acknowledge({...p,scope:'real'}),false);
 assert.equal(qa.acknowledge({...p,verified:false}),false);
 qa.uncertain();assert.equal(qa.next(),null);assert.equal(qa.acknowledge(p),false);
});
