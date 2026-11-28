import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinodeFeedLedger} from '../src/linode-feed-ledger.mjs';
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const thirdId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId};
function fixture(config={}){
 let row,gateState;const seen=new Set();const calls=[];
 const now=Date.parse('2026-11-27T18:00:00Z');
 const db={connect:async()=>({release(){},async query(sql,args=[]){
  calls.push(sql);
  if(sql.startsWith('SELECT *'))return {rows:row?[{...row}]:[]};
  if(sql.includes('FROM blofy_engine_ingress_gate'))return {rows:gateState?[{...gateState}]:[]};
  if(sql.includes('FROM blofy_engine_legacy_holds'))return {rows:[{n:config.openHolds??0}]};
  if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{now:new Date(now)}]};
  if(sql.startsWith('SELECT count(*)::int AS n FROM blofy_linode_feed_ledger'))return {rows:[{n:row&&row.engine_id===args[0]&&row.source_id!==args[1]&&row.state!=='released'?1:0}]};
  if(sql.startsWith('INSERT INTO blofy_linode_feed_requests')){
   if(seen.has(args[0]))return {rowCount:0};seen.add(args[0]);return {rowCount:1};
  }
  if(sql.startsWith('INSERT INTO blofy_linode_feed_ledger')){
   row={source_id:args[0],channel_id:args[1],request_id:args[2],reservation_id:args[3],state:'pending',engine_id:args[4]};
  }
  if(sql.startsWith('UPDATE blofy_linode_feed_ledger'))row.state=sql.match(/state='([^']+)'/)[1];
  if(sql.startsWith('UPDATE blofy_engine_ingress_gate')){
   gateState={mode:gateState.mode,reservation_id:args[1],engine_id:args[2]};
  }
  return {rows:[]};
 }})};
 return {db,calls,now,ledger:createLinodeFeedLedger(db,{...env,...config.env}),
  setGate:({mode,reservationId,engineId})=>{gateState={mode,reservation_id:reservationId,engine_id:engineId};},
  readGate:()=>gateState};
}
test('one start, idempotent retry, conflicting channel denied',async()=>{
 const {ledger,calls}=fixture();
 const input={sourceId,requestId,channelId:'123'};
 const a=await ledger.reserve(input);
 assert.equal(a.action,'start_once');
 const b=await ledger.reserve(input);
 assert.equal(b.action,'existing');assert.equal(b.reservationId,a.reservationId);
 assert.equal((await ledger.reserve({...input,requestId:secondId,channelId:'124'})).ok,false);
 assert.ok(calls.some(s=>s.includes('pg_advisory_xact_lock')));
});
test('unknown cannot reopen or release without trusted confirmation',async()=>{
 const {ledger}=fixture();const input={sourceId,requestId,channelId:'123'};
 const a=await ledger.reserve(input);
 const t={sourceId,reservationId:a.reservationId};
 assert.equal((await ledger.transition({...t,next:'unknown'})).ok,true);
 assert.equal((await ledger.reserve(input)).ok,false);
 assert.equal((await ledger.transition({...t,next:'released'})).ok,false);
 assert.equal((await ledger.reserve({...input,requestId:secondId})).ok,false);
 assert.equal((await ledger.transition({...t,next:'released',releaseConfirmed:true})).ok,true);
 const b=await ledger.reserve({...input,requestId:secondId});
 assert.equal(b.action,'start_once');
 await ledger.transition({sourceId,reservationId:b.reservationId,next:'released',releaseConfirmed:true});
 assert.equal((await ledger.reserve(input)).ok,false);
 assert.equal((await ledger.reserve({...input,requestId:thirdId})).ok,true);
});
test('disabled path never connects',async()=>{
 const ledger=createLinodeFeedLedger({connect(){throw Error('unexpected database access');}},{});
 assert.equal((await ledger.reserve({sourceId,requestId,channelId:'123'})).ok,false);
});

test('secondary engine is explicitly disabled by default',async()=>{
 const {ledger}=fixture();
 assert.equal((await ledger.reserve({sourceId,requestId,channelId:'123',engineId:'hostbrr'})).ok,false);
});

test('the standby replaces a released reservation without allowing legacy ingress',async()=>{
 const config={env:{BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_ENGINE_RENEWABLE_LEASE:'1'}};
 const {ledger,now,setGate,readGate,calls}=fixture(config);
 const {reservationId}=await ledger.reserve({sourceId,channelId:'123',requestId,engineId:'hostbrr'});
 setGate({mode:'engine',reservationId,engineId:'hostbrr'});
 const proof={sourceId,scope:'all_paths',authoritative:true,activeConnections:0,maxConnections:1,observedAt:now};
 const handoff={fromReservationId:reservationId,fromEngineId:'hostbrr',proof};
 const standby={sourceId,channelId:'123',requestId:secondId,engineId:'linode',handoff};
 assert.equal((await ledger.reserve(standby)).reason,'feed_occupied_or_uncertain');
 const owner={sourceId,reservationId,engineId:'hostbrr'};
 await ledger.transition({...owner,next:'unknown'});
 assert.equal((await ledger.reserve(standby)).reason,'feed_occupied_or_uncertain');
 await ledger.transition({...owner,next:'released',releaseConfirmed:true});
 assert.equal((await ledger.reserve({...standby,handoff:null})).reason,'handoff_required');
 assert.equal((await ledger.reserve({...standby,handoff:{...handoff,proof:{...proof,activeConnections:1}}})).reason,'handoff_capacity_unconfirmed');
 assert.equal((await ledger.reserve({...standby,handoff:{...handoff,proof:{...proof,observedAt:now-10001}}})).reason,'handoff_capacity_unconfirmed');
 config.openHolds=1;
 assert.equal((await ledger.reserve(standby)).reason,'handoff_legacy_holds_open');
 config.openHolds=0;
 const moved=await ledger.reserve(standby);
 assert.equal(moved.action,'start_once');
 assert.deepEqual(readGate(),{mode:'engine',reservation_id:moved.reservationId,engine_id:'linode'});
 assert.ok(calls.at(-2).startsWith('UPDATE blofy_engine_ingress_gate'));
 assert.equal(calls.at(-1),'COMMIT');
 assert.deepEqual(await ledger.reserve(standby),{...moved,action:'existing'});
 assert.equal((await ledger.transition({...owner,next:'released',releaseConfirmed:true})).ok,false);
});
