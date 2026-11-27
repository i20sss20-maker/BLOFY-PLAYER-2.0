import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiSourceRoute as plan} from '../src/blofy-engine-multi-source-plan.mjs';
const now=1700000000000;
const workers={hostbrr:{authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:20,viewerLimit:150},linode:{authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:40,viewerLimit:150}};
const candidate=(sourceId,poolId)=>({sourceId,poolId,contentId:'content',channelId:'10',
 identity:{authenticated:true,independentPoolVerified:true,sourceId,poolId,observedAt:now},
 entitlement:{sourceId,redistributionAllowed:true,expiresAt:now+60000},
 feed:{sourceId,state:'empty'},
 capacity:{sourceId,authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:now}});
const run=(candidates,overrides={})=>plan({candidates,workers,request:{contentId:'content',authorized:true,expiresAt:now+60000},now,enabled:true,...overrides});
test('chooses an independent source when the other source is occupied',()=>{
 const a=candidate('a','p1'),b=candidate('b','p2');
 a.feed={sourceId:'a',state:'pending'};
 assert.deepEqual(run([a,b]),{action:'request_reservation',engineId:'hostbrr',sourceId:'b',poolId:'p2',channelId:'10'});
});
test('duplicate aliases cannot multiply capacity',()=>{
 assert.equal(run([candidate('a','p1'),candidate('b','p1')]).action,'hold');
});
test('reuse a verified feed instead of opening another upstream connection',()=>{
 const a=candidate('a','p1'),b=candidate('b','p2');
 b.feed={sourceId:'b',state:'ready',engineId:'linode',channelId:'10',reservationId:'r',generation:'g'};
 b.feedProof={...b.feed,authenticated:true,status:'private_hls_ready',localSourceConnections:1,lastSegment:3,observedAt:now};
 assert.equal(run([a,b]).action,'reuse');
 assert.equal(run([a,b]).sourceId,'b');
});
test('fail closed for stale identity, missing rights, unavailable workers and disabled planner',()=>{
 const a=candidate('a','p1');
 a.identity.observedAt=now-300001;
 assert.equal(run([a]).action,'hold');
 const b=candidate('b','p2');b.entitlement.redistributionAllowed=false;
 assert.equal(run([b]).action,'hold');
 assert.equal(run([candidate('c','p3')],{workers:{}}).action,'hold');
 assert.equal(run([candidate('d','p4')],{enabled:false}).reason,'disabled');
});
test('cannot substitute another title or ambiguous source identity',()=>{
 const a=candidate('a','p1');a.contentId='different';
 assert.equal(run([a]).action,'hold');
 assert.equal(run([candidate('a','p1'),candidate('a','p2')]).reason,'duplicate_source_identity');
});
