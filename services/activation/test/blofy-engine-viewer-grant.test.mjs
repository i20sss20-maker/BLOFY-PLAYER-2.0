import test from 'node:test';
import assert from 'node:assert/strict';

import {createEngineViewerGrant} from '../src/blofy-engine-viewer-grant.mjs';
const now=Date.parse('2026-11-26T00:00:00Z'), expiresAt=new Date(now+120000).toISOString(), observedAt=new Date(now).toISOString();
const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reservationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={BLOFY_LINODE_SIGNED_HLS:'1',BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:accountId,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
function input(){return {context:{account:{id:accountId,enabled:true,max_connections:1,expires_at:expiresAt,source_id:sourceId},row:{server_id:sourceId,server_enabled:true,source_id:'123',source_reported_max_connections:1},kind:'live',method:'GET',distributorAllowed:true,rights:{verified:true,sourceId,mediaHost:'media.blofyplayer.com',expiresAt},engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId,channelId:'123',observedAt}},requestId,capacity:{authoritative:true,scope:'dedicated_licensed_pool',sourceId,providerQuota:1,observedAt},attempt:{requestId,state:'reserved',authoritative:true,committed:true,reservationId,accountId,sourceId,channelId:'123',expiresAt},worker:{generation:'f'.repeat(32),status:'private_hls_ready',sourceId,channelId:'123',reservationId,observedAt},signingKey:Buffer.alloc(32,1)}}

const sessionId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const settings={...env,BLOFY_ENGINE_VIEWER_GRANT:'1'};
test('signing is bounded by the committed lease, no grant before database confirms',async()=>{
 let calls=0;
 const issue=createEngineViewerGrant({async attachViewer(p){
  calls++;assert.equal(p.sessionId,sessionId);assert.equal(p.accountId,accountId);assert.equal(p.accountQuota,1);
  assert.equal(p.authorizedUntil,new Date(now+60000).toISOString());
  return {ok:true,sessionId,reservationId,expiresAt:new Date(now+15000).toISOString()};
 }},settings,()=>now);
 const grant=await issue({...input(),sessionId});
 assert.equal(calls,1);assert.equal(grant.ok,true);
 assert.equal(grant.expiresAt,new Date(now+15000).toISOString());
 assert.equal(grant.mediaHost,'media.blofyplayer.com');
 assert.equal(grant.reservationId,undefined);
});
test('database denial, ambiguous error, identity mismatch and stale evidence fail closed',async()=>{
 const variants=[async()=>({ok:false}),async()=>{throw Error('timeout');},async()=>({ok:true,sessionId:requestId,reservationId,expiresAt}),async()=>({ok:true,sessionId,reservationId:requestId,expiresAt})];
 for(const attachViewer of variants)assert.equal((await createEngineViewerGrant({attachViewer},settings,()=>now)({...input(),sessionId})).ok,false);
 let t=now;const issue=createEngineViewerGrant({async attachViewer(){t+=11000;return {ok:true,sessionId,reservationId,expiresAt};}},settings,()=>t);
 assert.equal((await issue({...input(),sessionId})).ok,false);
});
test('invalid or disabled requests never touch the ledger',async()=>{
 const ledger={async attachViewer(){assert.fail('unexpected ledger call');}};
 assert.equal((await createEngineViewerGrant(ledger,{},()=>now)({...input(),sessionId})).ok,false);
 const i=input();i.context.distributorAllowed=false;
 assert.equal((await createEngineViewerGrant(ledger,settings,()=>now)({...i,sessionId})).ok,false);
 assert.equal((await createEngineViewerGrant(ledger,settings,()=>now)({...input(),sessionId:'bad'})).ok,false);
});
