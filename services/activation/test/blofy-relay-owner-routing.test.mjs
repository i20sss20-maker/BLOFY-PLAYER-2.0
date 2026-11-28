import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOwnedRelayEnvironment,isConfiguredRelayTicket,issueStreamRelayGrant} from '../src/xtream-stream-relay-bridge.mjs';
const sourceId='d2bb0397-1c56-4751-adc9-1a17758022f6', other='d2bb0397-1c56-4751-adc9-1a17758022f7';
const env={BLOFY_RELAY_OWNER_ROUTING:'1',BLOFY_RELAY_ENGINE_OWNERSHIP:'1',BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'1',BLOFY_STREAM_RELAY_MEDIA_ORIGIN:'https://media2.blofyplayer.com',BLOFY_STREAM_RELAY_SHARED_TOKEN:'a'.repeat(64),BLOFY_STREAM_RELAY_ENABLED:'1'};
const path='/relay/'+'a'.repeat(48);
test('routing reads committed owner on every grant, never on default off',async()=>{
 let owner='hostbrr',reads=0;
 const select=(e=env,id=sourceId)=>selectOwnedRelayEnvironment({env:e,sourceId:id,readApprovedSource:async()=>sourceId,readOwner:async()=>{reads++;return {mode:'legacy',relay_owner:owner}}});
 const off={...env,BLOFY_RELAY_OWNER_ROUTING:'0'};
 assert.equal(await select(off),off);assert.equal(reads,0);
 assert.equal((await select()).BLOFY_STREAM_RELAY_MEDIA_ORIGIN,'https://media2.blofyplayer.com');
 owner='linode';
 const selected=await select();
 assert.equal(selected.BLOFY_STREAM_RELAY_MEDIA_ORIGIN,'https://media.blofyplayer.com');
 assert.equal(reads,2);
 assert.equal(await select(env,other),env);assert.equal(reads,2);
 assert.equal(await issueStreamRelayGrant({kind:'movie',sourceUrl:'https://example.invalid/fixture'},{env:selected,fetchImpl:async(url)=>{
   assert.equal(url,'https://media.blofyplayer.com/internal/relay-grants');
   return new Response(JSON.stringify({ok:true,path,expiresInSeconds:45}));
 }}),'https://media.blofyplayer.com'+path);
});
test('draining, unknown owner and missing proof never issue an owner grant',async()=>{
 for(const row of [null,{mode:'draining',relay_owner:'hostbrr'},{mode:'legacy',relay_owner:'toString'},{mode:'legacy',relay_owner:null}]){
  await assert.rejects(selectOwnedRelayEnvironment({env,sourceId,readApprovedSource:async()=>sourceId,readOwner:async()=>row}),/relay_owner_unavailable/);
 }
 await assert.rejects(selectOwnedRelayEnvironment({env,sourceId,readApprovedSource:async()=>null,readOwner:async()=>{throw Error('unexpected')}}),/relay_owner_source_unconfirmed/);
 await assert.rejects(selectOwnedRelayEnvironment({env:{...env,BLOFY_RELAY_ENGINE_OWNERSHIP:'0'},sourceId}),/relay_owner_routing_not_ready/);
});
test('only known opaque relay URLs may be redeemed; default remains pinned',()=>{
 assert.equal(isConfiguredRelayTicket('https://media.blofyplayer.com'+path,env),true);
 assert.equal(isConfiguredRelayTicket('https://media.blofyplayer.com'+path,{...env,BLOFY_RELAY_OWNER_ROUTING:'0'}),false);
 for(const url of ['https://example.invalid'+path,'https://media.blofyplayer.com'+path+'?x=1','https://media.blofyplayer.com/other','https://x@media.blofyplayer.com'+path])assert.equal(isConfiguredRelayTicket(url,env),false);
});
