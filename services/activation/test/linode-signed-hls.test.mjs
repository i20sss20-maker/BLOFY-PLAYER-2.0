import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {signedLinodePlayback} from '../src/linode-signed-hls.mjs';
const now=Date.parse('2026-11-26T00:00:00Z'), expiresAt=new Date(now+120000).toISOString(), observedAt=new Date(now).toISOString();
const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reservationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={BLOFY_LINODE_SIGNED_HLS:'1',BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:accountId,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
function input(){return {context:{account:{id:accountId,enabled:true,max_connections:1,expires_at:expiresAt,source_id:sourceId},row:{server_id:sourceId,server_enabled:true,source_id:'123',source_reported_max_connections:1},kind:'live',method:'GET',distributorAllowed:true,rights:{verified:true,sourceId,mediaHost:'media.blofyplayer.com',expiresAt},engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId,channelId:'123',observedAt}},requestId,capacity:{authoritative:true,scope:'dedicated_licensed_pool',sourceId,providerQuota:1,observedAt},attempt:{requestId,state:'reserved',authoritative:true,committed:true,reservationId,accountId,sourceId,channelId:'123',expiresAt},worker:{generation:'f'.repeat(32),status:'private_hls_ready',sourceId,channelId:'123',reservationId,observedAt},signingKey:Buffer.alloc(32,1)}}
test('matches local signed delivery format and bounded expiry',()=>{
 const i=input(),result=signedLinodePlayback(i,env,now);
 assert.equal(result.ok,true);
 const parts=result.path.split('/');
 assert.equal(parts[1],'v1');assert.equal(parts[2],i.worker.generation);assert.equal(parts[3],accountId.replaceAll('-',''));
 assert.equal(parts[4],String(now/1000+60));
 assert.equal(parts[5],createHmac('sha256',i.signingKey).update('BLOFY-LIVE-V1\n'+parts.slice(2,5).join('\n')).digest('hex'));
 assert.equal(parts[6],'index.m3u8');
});
test('fails closed for disabled, unknown reservation, stale worker, wrong channel, wrong reservation and missing key',()=>{
 assert.equal(signedLinodePlayback(input(),{},now).ok,false);
 for(const change of [i=>i.attempt.state='unknown',i=>i.worker.observedAt=new Date(now-11000).toISOString(),i=>i.worker.channelId='124',i=>i.worker.reservationId=requestId,i=>i.signingKey=null,i=>i.capacity.authoritative=false,i=>i.context.distributorAllowed=false]){
  const i=input();change(i);assert.equal(signedLinodePlayback(i,env,now).ok,false);
 }
});
