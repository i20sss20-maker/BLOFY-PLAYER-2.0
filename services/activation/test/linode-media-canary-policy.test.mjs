import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLinodeMediaCanary as check} from '../src/linode-media-canary-policy.mjs';
const now=Date.parse('2026-11-26T00:00:00Z');
const accountId='00000000-0000-4000-8000-000000000001';
const sourceId='00000000-0000-4000-8000-000000000002';
const env={BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:accountId};
const date=offset=>new Date(now+offset).toISOString();
const fixture=()=>({
 account:{id:accountId,sourceId,enabled:true,authenticated:true,expiresAt:date(120000)},
 source:{id:sourceId,enabled:true,restreamAuthorized:true,distributionRightsVerified:true},
 channel:{id:'123',sourceId,kind:'live',entitled:true},
 engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,observedAt:date(-1000)},
 reservation:{id:'00000000-0000-4000-8000-000000000003',sourceId,accountId,channelId:'123',committed:true,expiresAt:date(30000)}
});
test('disabled by default, one explicit authenticated test account only',()=>{
 assert.equal(check(fixture(),{},now).route,'legacy');
 for(const patch of [{authenticated:false},{enabled:false},{id:sourceId},{expiresAt:date(-1)},{expiresAt:null}]){
   const f=fixture();Object.assign(f.account,patch);assert.equal(check(f,env,now).allowed,false);
 }
});
test('authorization, entitlement and capacity all required',()=>{
 for(const [key,patch] of [
 ['source',{restreamAuthorized:false}],['source',{distributionRightsVerified:false}],
 ['source',{id:accountId}],['channel',{entitled:false}],['channel',{kind:'movie'}],
 ['channel',{sourceId:accountId}],['reservation',{committed:false}],
 ['reservation',{accountId:sourceId}],['reservation',{channelId:'999'}],
 ['reservation',{expiresAt:date(-1)}],['engine',{healthy:false}],
 ['engine',{realSourceVerified:false}],['engine',{customerTrafficEnabled:true}],
 ['engine',{observedAt:date(-91000)}],['engine',{observedAt:date(6000)}]
 ]){
  const f=fixture();Object.assign(f[key],patch);
  assert.equal(check(f,env,now).route,'legacy',JSON.stringify(patch));
 }
});
test('eligible test session bounded by reservation and account expiry',()=>{
 const f=fixture();assert.deepEqual(check(f,env,now),{allowed:true,reason:'eligible',route:'linode-canary',expiresAt:date(30000)});
 f.account.expiresAt=date(10000);assert.equal(check(f,env,now).expiresAt,date(10000));
 f.account.expiresAt=date(120000);f.reservation.expiresAt=date(120000);assert.equal(check(f,env,now).expiresAt,date(60000));
});
