import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinodeFeedLedger} from '../src/linode-feed-ledger.mjs';
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const thirdId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId};
function fixture(){
 let row;const seen=new Set();const calls=[];
 const db={connect:async()=>({release(){},async query(sql,args=[]){
  calls.push(sql);
  if(sql.startsWith('SELECT *'))return {rows:row?[{...row}]:[]};
  if(sql.startsWith('SELECT count(*)::int AS n FROM blofy_linode_feed_ledger'))return {rows:[{n:row&&row.engine_id===args[0]&&row.source_id!==args[1]&&row.state!=='released'?1:0}]};
  if(sql.startsWith('INSERT INTO blofy_linode_feed_requests')){
   if(seen.has(args[0]))return {rowCount:0};seen.add(args[0]);return {rowCount:1};
  }
  if(sql.startsWith('INSERT INTO blofy_linode_feed_ledger')){
   row={source_id:args[0],channel_id:args[1],request_id:args[2],reservation_id:args[3],state:'pending',engine_id:args[4]};
  }
  if(sql.startsWith('UPDATE'))row.state=sql.match(/state='([^']+)'/)[1];
  return {rows:[]};
 }})};
 return {db,calls,ledger:createLinodeFeedLedger(db,env)};
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
