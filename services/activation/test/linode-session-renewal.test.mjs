import test from 'node:test';
import assert from 'node:assert/strict';
import {renewLinodeSession} from '../src/linode-session-renewal.mjs';
const now=Date.parse('2026-11-26T00:00:00Z'), expiresAt=new Date(now+120000).toISOString(), observedAt=new Date(now).toISOString();
const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reservationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={BLOFY_LINODE_SESSION_RENEWAL:'1',BLOFY_LINODE_SIGNED_HLS:'1',BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:accountId,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
function input(){return {context:{account:{id:accountId,enabled:true,max_connections:1,expires_at:expiresAt,source_id:sourceId},row:{server_id:sourceId,server_enabled:true,source_id:'123',source_reported_max_connections:1},kind:'live',method:'GET',distributorAllowed:true,rights:{verified:true,sourceId,mediaHost:'media.blofyplayer.com',expiresAt},engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId,channelId:'123',observedAt}},requestId,capacity:{authoritative:true,scope:'dedicated_licensed_pool',sourceId,providerQuota:1,observedAt},attempt:{requestId,state:'reserved',authoritative:true,committed:true,reservationId,accountId,sourceId,channelId:'123',expiresAt},worker:{generation:'f'.repeat(32),status:'private_hls_ready',sourceId,channelId:'123',reservationId,observedAt},signingKey:Buffer.alloc(32,1)}}

function renewal(){
 const i=input();
 return {...i,session:{state:'active',accountId,sourceId,channelId:'123',requestId,reservationId,generation:i.worker.generation,expiresAt}};
}
test('refreshes only the matching active session and caps expiry',()=>{
 const i=renewal();
 i.session.expiresAt=new Date(now+22000).toISOString();
 const grant=renewLinodeSession(i,env,now);
 assert.equal(grant.ok,true);
 assert.equal(grant.expiresAt,i.session.expiresAt);
});
test('requires opt-in and rejects ended sessions or changed identity',()=>{
 assert.equal(renewLinodeSession(renewal(),{},now).ok,false);
 for(const change of [
  i=>i.session.state='released',i=>i.session.expiresAt=new Date(now-1).toISOString(),
  i=>i.session.accountId=sourceId,i=>i.session.channelId='124',
  i=>i.session.sourceId=accountId,i=>i.session.requestId=reservationId,
  i=>i.session.reservationId=requestId,i=>i.session.generation='a'.repeat(32),
  i=>i.context.account.enabled=false,i=>i.context.distributorAllowed=false,
  i=>i.attempt.state='unknown',i=>i.capacity.authoritative=false,
  i=>i.worker.observedAt=new Date(now-11000).toISOString()
 ]){const i=renewal();change(i);assert.equal(renewLinodeSession(i,env,now).ok,false);}
});
