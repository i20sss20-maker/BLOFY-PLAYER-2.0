import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reserveLinodeFeed,releaseLinodeFeed,installReservationSchema} from '../src/linode-reservation-ledger.mjs';

test('unverified allocation and uncertain release never touch DB',async()=>{
 const pool={connect(){throw Error('must not connect')}};
 const r=await reserveLinodeFeed(pool,{},{});assert.equal(r.state,'denied');assert.equal(r.authoritative,false);
 assert.equal((await releaseLinodeFeed(pool,{})).state,'unknown');
});
test('dedicated pool serializes concurrent reservations and keeps expired slots occupied',
 {skip:!process.env.BLOFY_RESERVATION_TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:process.env.BLOFY_RESERVATION_TEST_DATABASE_URL,max:8});
 try{
   await installReservationSchema(pool);
   const now=Date.now(),sourceId=randomUUID();
   const grant={verified:true,scope:'dedicated_licensed_pool',sourceId,quota:1,expiresAt:new Date(now+120000).toISOString()};
   const request=()=>({requestId:randomUUID(),sourceId,accountId:randomUUID(),channelId:'123',expiresAt:new Date(now+30000).toISOString()});
   const requests=Array.from({length:8},request);
   const results=await Promise.all(requests.map(r=>reserveLinodeFeed(pool,r,grant,now)));
   assert.equal(results.filter(r=>r.state==='reserved').length,1);
   assert.equal(results.filter(r=>r.reason==='capacity_exhausted').length,7);
   const winner=results.find(r=>r.state==='reserved');
   const original=requests.find(r=>r.requestId===winner.requestId);
   const replay=await reserveLinodeFeed(pool,original,grant,now);
   assert.equal(replay.reservationId,winner.reservationId);
   const conflict=await reserveLinodeFeed(pool,{...original,channelId:'999'},grant,now);
   assert.equal(conflict.reason,'request_conflict');
   const next={...request(),expiresAt:new Date(now+90000).toISOString()};
   assert.equal((await reserveLinodeFeed(pool,next,grant,now+60000)).reason,'capacity_exhausted');
   assert.equal((await releaseLinodeFeed(pool,{...winner,noFeedRemaining:false})).state,'unknown');
   assert.equal((await releaseLinodeFeed(pool,{...winner,noFeedRemaining:true})).state,'released');
   assert.equal((await releaseLinodeFeed(pool,{...winner,noFeedRemaining:true})).state,'released');
   assert.equal((await reserveLinodeFeed(pool,next,grant,now+60000)).state,'reserved');
   assert.equal((await reserveLinodeFeed(pool,original,grant,now)).state,'released');
 }finally{await pool.end()}
});
