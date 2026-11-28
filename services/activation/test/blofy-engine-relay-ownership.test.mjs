import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineIngressGate} from '../src/blofy-engine-ingress-gate.mjs';
const sourceId='11111111-1111-4111-8111-111111111111';
const hold='22222222-2222-4222-8222-222222222222';
const now=Date.now();
function fixture({mode='draining',owner='hostbrr',nextOwner='linode',holds=0,state=null}={}){
 const row={mode,relay_owner:owner,relay_next_owner:mode==='draining'?nextOwner:null,updated_at:new Date(now-1000)};
 const calls=[];
 const pool={async connect(){return {release(){},async query(sql,args){
  calls.push({sql,args});
  if(sql.startsWith('SELECT *'))return {rows:[row]};
  if(sql.startsWith('SELECT clock_timestamp'))return {rows:[{now:new Date(now)}]};
  if(sql.startsWith('SELECT count'))return {rows:[{n:holds}]};
  if(sql.startsWith('SELECT state'))return {rows:state?[{state}]:[]};
  if(sql.startsWith("UPDATE blofy_engine_ingress_gate SET mode='draining'")){row.mode='draining';row.relay_next_owner=args[1];row.updated_at=new Date(now);return {rows:[{updated_at:row.updated_at}],rowCount:1};}
  if(sql.startsWith("UPDATE blofy_engine_ingress_gate SET mode='legacy'")){row.mode='legacy';row.relay_next_owner=null;if(args.length>1)row.relay_owner=args[1];return {rowCount:1};}
  if(sql.startsWith('INSERT INTO blofy_engine_legacy_holds'))return {rowCount:1};
  return {rows:[]};
 }}}};
 return {gate:createEngineIngressGate(pool,{sourceId,enabled:true}),row,calls};
}
const proof={sourceId,previousOwner:'hostbrr',authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:now,drainStartedAt:now-1000};
test('only owner can acquire portable relay hold',async()=>{
 const {gate,calls}=fixture({mode:'legacy'});
 assert.equal((await gate.enterOwnedRelay(hold,'linode')).ok,false);
 assert.equal((await gate.enterOwnedRelay(hold,'hostbrr')).ok,true);
 assert.deepEqual(calls.filter(x=>x.sql.startsWith('INSERT INTO')).map(x=>x.args),[[sourceId,hold,'hostbrr']]);
});
test('transition fails closed on missing proof, wrong epoch, active holds or unresolved reservation',async()=>{
 for(const [options,p] of [[{},null],[{},{...proof,activeConnections:1}],[{},{...proof,scope:'local'}],[{},{...proof,drainStartedAt:now-2000}],[{holds:1},proof],[{state:'unknown'},proof],[{mode:'legacy'},proof],[{owner:'linode'},proof],[{nextOwner:null},proof],[{nextOwner:'hostbrr'},proof]]){
  const {gate,calls}=fixture(options);
  assert.equal((await gate.commitRelayOwner({expectedOwner:'hostbrr',nextOwner:'linode',proof:p})).ok,false);
  assert.equal(calls.some(x=>x.sql.startsWith('UPDATE blofy_engine_ingress_gate')),false);
 }
});
test('confirmed drained source transitions once, allowing only the new owner',async()=>{
 const {gate,row}=fixture();
 assert.equal((await gate.commitRelayOwner({expectedOwner:'hostbrr',nextOwner:'linode',proof})).ok,true);
 assert.equal(row.relay_owner,'linode');
 assert.equal((await gate.enterOwnedRelay(hold,'hostbrr')).ok,false);
 assert.equal((await gate.enterOwnedRelay(hold,'linode')).ok,true);
 assert.equal((await gate.commitRelayOwner({expectedOwner:'hostbrr',nextOwner:'linode',proof})).ok,false);
});

test('relay transition intent is durable and compared before cancel or commit',async()=>{
 const {gate,row}=fixture({mode:'legacy'});
 assert.equal((await gate.beginRelayDrain({expectedOwner:'linode',nextOwner:'hostbrr'})).ok,false);
 const drain=await gate.beginRelayDrain({expectedOwner:'hostbrr',nextOwner:'linode'});
 assert.equal(drain.ok,true);
 assert.deepEqual(await gate.readRelayOwnerState(),{ok:true,mode:'draining',owner:'hostbrr',nextOwner:'linode',epoch:now,openHolds:0});
 assert.equal((await gate.beginRelayDrain({expectedOwner:'hostbrr',nextOwner:'linode'})).ok,false);
 assert.equal((await gate.cancelDrain()).ok,false);
 assert.equal((await gate.cancelRelayDrain({expectedOwner:'hostbrr',nextOwner:'linode',epoch:now-1})).ok,false);
 assert.equal((await gate.cancelRelayDrain({expectedOwner:'hostbrr',nextOwner:'linode',epoch:now})).ok,true);
 assert.equal(row.relay_owner,'hostbrr');assert.equal(row.relay_next_owner,null);
});
