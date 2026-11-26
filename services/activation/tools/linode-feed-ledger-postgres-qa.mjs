import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {ensureLinodeFeedLedger,createLinodeFeedLedger} from '../src/linode-feed-ledger.mjs';

// Only the disposable CI database, never DATABASE_URL or production.
const options={host:'127.0.0.1',port:5432,database:'blofy_ledger_qa',
 user:'blofy_qa',password:'blofy_qa_local_only',connectionTimeoutMillis:5000};
test('concurrent reservations, restart persistence and release fencing',{timeout:60000},async()=>{
 const admin=new pg.Pool({...options,max:1});
 const schema='qa_'+randomUUID().replaceAll('-','');
 let pool;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  pool=new pg.Pool({...options,options:'-c search_path='+schema,max:12});
  await ensureLinodeFeedLedger(pool);
  const sourceId=randomUUID(),requestId=randomUUID();
  const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_LINODE_VIEWER_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId};
  const ledger=createLinodeFeedLedger(pool,env);
  const args={sourceId,channelId:'123',requestId};
  const all=await Promise.all(Array.from({length:30},()=>ledger.reserve(args)));
  assert.equal(all.filter(x=>x.action==='start_once').length,1);
  assert.equal(all.filter(x=>x.action==='existing').length,29);
  const reservationId=all[0].reservationId;
  assert.ok(all.every(x=>x.reservationId===reservationId));
  const conflict=await Promise.all(Array.from({length:20},()=>ledger.reserve({...args,channelId:'124',requestId:randomUUID()})));
  assert.ok(conflict.every(x=>!x.ok));
  await pool.end();
  pool=new pg.Pool({...options,options:'-c search_path='+schema,max:12});
  const restored=createLinodeFeedLedger(pool,env);
  assert.equal((await restored.reserve(args)).action,'existing');
  const t={sourceId,reservationId};
  const generation=randomUUID().replaceAll('-','');
  assert.equal((await restored.transition({...t,next:'ready',generation})).ok,true);
  const viewer={...t,channelId:'123',generation,sessionId:randomUUID(),accountId:randomUUID(),
    accountQuota:1,authorizedUntil:new Date(Date.now()+120000).toISOString()};
  const firstGrant=await restored.attachViewer(viewer);
  assert.equal(firstGrant.ok,true);
  const shortGrant=await restored.attachViewer({...viewer,authorizedUntil:new Date(Date.now()+20000).toISOString()});
  assert.equal(shortGrant.ok,true);
  assert.ok(Date.parse(shortGrant.expiresAt)<Date.parse(firstGrant.expiresAt));
  const {rows:[stored]}=await pool.query('SELECT expires_at FROM blofy_linode_viewer_sessions WHERE session_id=$1',[viewer.sessionId]);
  assert.equal(new Date(stored.expires_at).toISOString(),firstGrant.expiresAt);
  assert.equal((await restored.attachViewer({...viewer,sessionId:randomUUID()})).reason,'viewer_quota');
  const other={...viewer,sessionId:randomUUID(),accountId:randomUUID()};
  assert.equal((await restored.attachViewer(other)).ok,true);
  assert.equal((await restored.attachViewer({...other,generation:'0'.repeat(32)})).ok,false);
  assert.equal((await restored.closeViewer(viewer)).ok,true);
  assert.equal((await restored.attachViewer(viewer)).ok,false);
  assert.equal((await restored.attachViewer({...viewer,sessionId:randomUUID()})).reason,'viewer_quota');
  const more=await Promise.all(Array.from({length:155},()=>restored.attachViewer({...viewer,accountId:randomUUID(),sessionId:randomUUID()})));
  assert.equal(more.filter(x=>x.ok).length,148);
  assert.equal(more.filter(x=>x.reason==='viewer_quota').length,7);
  assert.equal((await restored.transition({...t,next:'unknown'})).ok,true);
  assert.equal((await restored.transition({...t,next:'released'})).ok,false);
  assert.equal((await restored.reserve({...args,requestId:randomUUID()})).ok,false);
  assert.equal((await restored.transition({...t,next:'released',releaseConfirmed:true})).ok,true);
  const newId=randomUUID();
  const next=await restored.reserve({...args,requestId:newId});
  assert.equal(next.action,'start_once');
  assert.equal((await restored.transition({...t,next:'released',releaseConfirmed:true})).ok,false);
  assert.equal((await restored.transition({sourceId,reservationId:next.reservationId,next:'released',releaseConfirmed:true})).ok,true);
  assert.equal((await restored.reserve(args)).ok,false);
 }finally{
  if(pool)await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').finally(()=>admin.end());
 }
});
