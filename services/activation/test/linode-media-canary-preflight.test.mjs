import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightLinodeLive as check} from '../src/linode-media-canary-preflight.mjs';
const now=Date.parse('2026-11-26T00:00:00Z');
const a='00000000-0000-4000-8000-000000000001',s='00000000-0000-4000-8000-000000000002';
const date=ms=>new Date(now+ms).toISOString();
const env={BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:a,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:s,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
const fixture=()=>({account:{id:a,source_id:s,enabled:true,expires_at:new Date(now+120000),max_connections:1},
 row:{server_id:s,source_id:'123',server_enabled:true,source_reported_max_connections:1,username_secret:'NEVER_RETURN',password_secret:'NEVER_RETURN',base_url:'NEVER_RETURN'},
 kind:'live',method:'GET',distributorAllowed:true,
 rights:{verified:true,sourceId:s,mediaHost:'media.blofyplayer.com',expiresAt:date(30000)},
 engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId:s,channelId:'123',observedAt:date(-1000)}});
test('only the pinned account, source and channel can request reservation',()=>{
 const f=fixture();assert.equal(check(f,{},now).eligible,false);
 for(const [key,patch] of [['account',{id:s}],['account',{source_id:null}],['account',{expires_at:null}],['account',{enabled:false}],['row',{source_id:'124'}],['row',{server_id:a}],['row',{server_enabled:false}],['row',{source_reported_max_connections:null}],['row',{source_reported_max_connections:0}],['rights',{verified:false}],['rights',{mediaHost:'other.example'}],['rights',{sourceId:a}],['rights',{expiresAt:date(-1)}],['engine',{realSourceVerified:false}],['engine',{customerTrafficEnabled:true}],['engine',{observedAt:date(-91000)}],['engine',{sourceId:a}],['engine',{channelId:'124'}]]){
  const x=fixture();Object.assign(x[key],patch);assert.equal(check(x,env,now).eligible,false,JSON.stringify(patch));
 }
 for(const patch of [{method:'HEAD'},{kind:'movie'},{distributorAllowed:false}]){
  assert.equal(check({...fixture(),...patch},env,now).eligible,false);
 }
});
test('health telemetry alone cannot authorize a real source',()=>{
 const f=fixture();f.engine={healthy:true,observedAt:date(-1000)};assert.equal(check(f,env,now).eligible,false);
});
test('eligible preflight carries quotas, bounded expiry, no credentials or grant',()=>{
 const result=check(fixture(),env,now);assert.deepEqual(result,{eligible:true,reason:'reservation_required',accountId:a,sourceId:s,channelId:'123',providerQuota:1,accountQuota:1,expiresAt:date(30000)});
 assert.ok(!JSON.stringify(result).includes('NEVER_RETURN'));
});
