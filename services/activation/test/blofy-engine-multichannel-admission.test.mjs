import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiChannelAdmission as plan} from '../src/blofy-engine-multichannel-admission.mjs';
const now=1795756200000;
const sourceId='11111111-1111-4111-8111-111111111111';
const worker={authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:180,activeFeeds:0,maxFeeds:16};
const reservation=(n,state='ready',engineId='hostbrr')=>{
 const r={sourceId,channelId:String(n),reservationId:'22222222-2222-4222-8222-'+String(n).padStart(12,'0'),state,engineId,generation:'a'.repeat(32)};
 return {...r,proof:{...r,authenticated:true,observedAt:now,status:'private_hls_ready',localSourceConnections:1,lastSegment:10}};
};
const context=(reservations=[],id='100')=>({enabled:true,now,
 request:{sourceId,channelId:id,authorized:true,expiresAt:now+5000},
 entitlement:{sourceId,redistributionAllowed:true,maxFeeds:16,expiresAt:now+10000},
 snapshot:{sourceId,authenticated:true,observedAt:now,mode:'engine_only',allPathsFenced:true,legacyHolds:0,activeConnections:reservations.filter(r=>r.state==='ready').length,revision:10,reservations},
 workers:{hostbrr:{...worker,activeFeeds:reservations.filter(r=>r.engineId==='hostbrr'&&r.state==='ready').length},linode:{...worker,activeFeeds:reservations.filter(r=>r.engineId==='linode'&&r.state==='ready').length}}});
test('primary admits independent channels and reuses existing feed for another viewer',()=>{
 const c=context([reservation(1),reservation(2)]);
 assert.deepEqual(plan(c),{action:'request_reservation',sourceId,channelId:'100',snapshotRevision:10,engineId:'hostbrr',maxFeeds:16});
 const same=context([reservation(1),reservation(2)],'1');
 assert.equal(plan(same).action,'reuse');assert.equal(plan(same).reservationId,reservation(1).reservationId);
});
test('sixteen occupied slots include pending and draining feeds; no extra upstream',()=>{
 const c=context(Array.from({length:16},(_,i)=>reservation(i+1,i===15?'release_unknown':'ready')));
 assert.deepEqual(plan(c),{action:'hold',reason:'source_capacity'});
 assert.equal(plan({...c,request:{...c.request,channelId:'1'}}).action,'reuse');
 assert.equal(plan({...c,request:{...c.request,channelId:'16'}}).reason,'reservation_pending_or_unreleased');
});
test('standby never publishes duplicate active feed; primary failure requires release',()=>{
 const c=context([reservation(1)],'1');
 c.workers.hostbrr.heartbeatActive=false;
 assert.equal(plan(c).action,'request_fenced_release');
 const newChannel={...c,request:{...c.request,channelId:'2'}};
 assert.equal(plan(newChannel).engineId,'linode');
 c.workers.hostbrr.heartbeatActive=true;
 c.workers.hostbrr.activeViewers=180;
 assert.equal(plan(newChannel).reason,'no_healthy_capacity');
});
test('legacy traffic, stale or ambiguous evidence and untracked connections fail closed',()=>{
 const c=context([reservation(1)]);
 for(const patch of [{allPathsFenced:false},{legacyHolds:1},{mode:'legacy'},{observedAt:now-11000},{authenticated:false}]){
  assert.equal(plan({...c,snapshot:{...c.snapshot,...patch}}).reason,'source_authority_unconfirmed');
 }
 assert.equal(plan({...c,snapshot:{...c.snapshot,activeConnections:2}}).reason,'untracked_source_connection');
 assert.equal(plan({...c,snapshot:{...c.snapshot,reservations:[reservation(1),reservation(1)]}}).reason,'reservation_snapshot_invalid');
 assert.equal(plan({...c,enabled:false}).reason,'disabled');
});
test('existing viewers are subject to proof identity and independent viewer capacity',()=>{
 const c=context([reservation(1)],'1');
 c.snapshot.reservations[0].proof.lastSegment=-1;
 assert.equal(plan(c).reason,'feed_progress_unconfirmed');
 c.snapshot.reservations[0]=reservation(1);
 c.workers.hostbrr.activeViewers=180;
 assert.equal(plan(c).reason,'viewer_capacity');
});
