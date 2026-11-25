import test from 'node:test';
import assert from 'node:assert/strict';
import {decideLinodeAdmission as check} from '../src/linode-media-admission.mjs';
const now=Date.parse('2026-11-26T00:00:00Z');
const a='00000000-0000-4000-8000-000000000001',s='00000000-0000-4000-8000-000000000002',q='00000000-0000-4000-8000-000000000003',r='00000000-0000-4000-8000-000000000004';
const date=ms=>new Date(now+ms).toISOString();
const env={BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:a,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:s,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
const fixture=()=>({requestId:q,context:{account:{id:a,source_id:s,enabled:true,expires_at:date(120000),max_connections:1},
row:{server_id:s,source_id:'123',server_enabled:true,source_reported_max_connections:1},kind:'live',method:'GET',distributorAllowed:true,
rights:{verified:true,sourceId:s,mediaHost:'media.blofyplayer.com',expiresAt:date(30000)},
engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId:s,channelId:'123',observedAt:date(-1000)}},
capacity:{authoritative:true,scope:'all_paths',sourceId:s,providerQuota:1,observedAt:date(-1000)},
attempt:{requestId:q,state:'not_started'}});
const reserved=()=>{const f=fixture();f.attempt={requestId:q,state:'reserved',authoritative:true,committed:true,reservationId:r,accountId:a,sourceId:s,channelId:'123',expiresAt:date(90000)};return f};
test('disabled or no cross-plane capacity owner cannot start canary',()=>{
 assert.equal(check(fixture(),{},now).action,'legacy');
 for(const patch of [{authoritative:false},{scope:'local_counter'},{providerQuota:2},{sourceId:a},{observedAt:date(-16000)}]){
 const f=fixture();Object.assign(f.capacity,patch);assert.equal(check(f,env,now).action,'legacy');
 }
});
test('reserve only after preflight, with bounded source and account quota',()=>{
 assert.deepEqual(check(fixture(),env,now),{action:'reserve',requestId:q,accountId:a,sourceId:s,channelId:'123',providerQuota:1,accountQuota:1,expiresAt:date(30000)});
});
test('uncertain or pending reservation never opens a legacy feed',()=>{
 for(const state of ['pending','unknown','reserved','released','denied']){
 const f=fixture();f.attempt.state=state;assert.equal(check(f,{},now).action,'hold');
 }
 const f=fixture();delete f.attempt;assert.equal(check(f,env,now).action,'hold');
});
test('only matching committed reservation allows new route',()=>{
 assert.deepEqual(check(reserved(),env,now),{action:'linode',requestId:q,reservationId:r,expiresAt:date(30000)});
 for(const patch of [{committed:false},{authoritative:false},{sourceId:a},{channelId:'456'},{accountId:s},{expiresAt:date(-1)},{requestId:r}]){
 const f=reserved();Object.assign(f.attempt,patch);assert.equal(check(f,env,now).action,'hold');
 }
 const f=reserved();f.context.rights.verified=false;assert.equal(check(f,env,now).action,'hold');
 assert.equal(check(reserved(),{},now).action,'hold');
});
test('fallback only after explicit authoritative closure',()=>{
 for(const state of ['released','denied']){
 const f=fixture();f.attempt={requestId:q,state,authoritative:true,noNewFeed:true};
 assert.equal(check(f,env,now).action,'legacy');
 f.attempt.noNewFeed=false;assert.equal(check(f,env,now).action,'hold');
 }
});
