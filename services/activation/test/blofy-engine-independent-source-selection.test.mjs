import test from 'node:test';
import assert from 'node:assert/strict';
import {selectIndependentLiveSource as select} from '../src/blofy-engine-independent-source-selection.mjs';
const now=100000;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const auth={authenticated:true,observedAt:now};
const request={authorized:true,channelId:'10',expiresAt:now+10000};
function source(n,{busy=false,mapped=true,state='ready',sameChannel=false}={}){
 const sourceId=id(n);
 return {sourceId,entitlement:{sourceId,quotaGroupId:id(n+100),redistributionAllowed:true,
 independentQuotaVerified:true,expiresAt:now+10000,maxFeeds:1},
 authority:{...auth,sourceId,allPathsFenced:true,mode:'engine_only',legacyHolds:0,
 revision:1,activeConnections:busy?1:0,reservations:busy?[{sourceId,reservationId:id(n+200),
 channelId:sameChannel?'20':'99',state}]:[]},
 mapping:{...auth,sourceId,canonicalChannelId:'10',providerChannelIds:mapped?['20']:[],
 preferredChannelId:mapped?'20':null}};
}
const run=sources=>select({request,inventory:{...auth,complete:true,sources},now,enabled:true});
test('independent licensed account can serve a different channel when first source is full',()=>{
 assert.deepEqual(run([source(1,{busy:true}),source(2)]),{action:'check_admission',shadowOnly:true,sourceId:id(2),channelId:'20',snapshotRevision:1});
});
test('an existing channel is reused rather than opening another upstream',()=>{
 assert.equal(run([source(1,{busy:true,sameChannel:true}),source(2)]).action,'check_existing');
});
test('pending and uncertain release cannot trigger duplicate playback on another source',()=>{
 for(const state of ['reserved','starting','draining','release_unknown'])
 assert.equal(run([source(1,{busy:true,sameChannel:true,state}),source(2)]).reason,'existing_channel_not_released');
});
test('aliases of same quota are rejected rather than counted twice',()=>{
 const a=source(1),b=source(2);b.entitlement.quotaGroupId=a.entitlement.quotaGroupId;
 assert.equal(run([a,b]).reason,'entitlement_unconfirmed_or_duplicate_quota');
});
test('stale authority, unknown upstream, unfenced legacy path and unverified rights fail closed',()=>{
 for(const patch of [{observedAt:now-11000},{activeConnections:1},{allPathsFenced:false},{legacyHolds:1}]){
  const a=source(1);Object.assign(a.authority,patch);assert.equal(run([a,source(2)]).action,'hold');
 }
 const a=source(1);a.entitlement.independentQuotaVerified=false;assert.equal(run([a,source(2)]).action,'hold');
});
test('no source can exceed verified quota or serve unmapped channels',()=>{
 assert.equal(run([source(1,{busy:true}),source(2,{mapped:false})]).reason,'no_authorized_source_capacity');
});
test('duplicate canonical channel owners are not routed',()=>{
 assert.equal(run([source(1,{busy:true,sameChannel:true}),source(2,{busy:true,sameChannel:true})]).reason,'duplicate_channel_ownership');
});
test('feature defaults off and incomplete inventory is rejected',()=>{
 assert.equal(select({request,now}).reason,'disabled');
 assert.equal(select({request,inventory:{...auth,complete:false,sources:[source(1)]},now,enabled:true}).reason,'inventory_unconfirmed');
});
