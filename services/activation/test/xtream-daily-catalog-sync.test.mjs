import test from 'node:test';
import assert from 'node:assert/strict';
import {
 riyadhDailyCatalogWindow,requestDailyXtreamCatalogSync
} from '../src/xtream-daily-catalog-sync.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const opts={env:{
 BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID
},now:new Date('2026-11-14T01:15:00Z')};

test('daily scheduler is OFF by default and scoped to 04:00 Riyadh',()=>{
 assert.equal(riyadhDailyCatalogWindow(opts.now,{}).due,false);
 assert.equal(riyadhDailyCatalogWindow(opts.now,opts.env).due,true);
 assert.equal(riyadhDailyCatalogWindow(new Date('2026-11-14T02:15:00Z'),opts.env).due,false);
});

test('daily queue is once per Riyadh day with SQL claim',async()=>{
 const claims=new Set(),events=[];
 const db={async query(sql,args){
   if(sql.startsWith('CREATE')||sql.startsWith('ALTER'))return {rowCount:0};
   if(sql.startsWith('INSERT')){
     const key=args.join('|');
     if(claims.has(key))return {rowCount:0};
     claims.add(key);return {rowCount:1};
   }
   if(sql.startsWith('DELETE')){
     claims.delete(args.join('|'));return {rowCount:1};
   }
   throw Error('unexpected SQL');
 }};
 const getSource=async id=>({id,name:'saleh',enabled:true,deletion_requested_at:null});
 const startSync=(id,types)=>{events.push({id,types});return {queued:true}};
 const first=await requestDailyXtreamCatalogSync({...opts,db,getSource,startSync});
 assert.equal(first.requested,true);
 assert.equal(first.mediaFilesCopied,0);
 assert.deepEqual(events[0].types,['live','movie','series']);
 const second=await requestDailyXtreamCatalogSync({...opts,db,getSource,startSync});
 assert.equal(second.code,'already_requested_today');
 assert.equal(events.length,1);
});

test('never queues without source approval or configured exact UUID',async()=>{
 const forbidden=await requestDailyXtreamCatalogSync({
  ...opts,env:{...opts.env,BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:'bad'}
 });
 assert.equal(forbidden.code,'source_not_configured');
 let calls=0;
 const rejected=await requestDailyXtreamCatalogSync({
  ...opts,db:{query:async()=>{calls++;return {rowCount:1}}},
  getSource:async id=>({id,name:'other',enabled:true}),startSync:()=>{throw Error('must_not_run')}
 });
 assert.equal(rejected.code,'source_not_approved');
 assert.equal(calls,0);
});

test('enqueue failure releases day claim for bounded retry',async()=>{
 const calls=[];
 const result=await Promise.allSettled([requestDailyXtreamCatalogSync({
  ...opts,db:{query:async(sql,args)=>{calls.push(sql.split(' ')[0]);return {rowCount:1}}},
  getSource:async id=>({id,name:'saleh',enabled:true}),
  startSync:()=>{throw Error('queue_busy')}
 })]);
 assert.equal(result[0].status,'rejected');
 assert.deepEqual(calls,['CREATE','ALTER','INSERT','DELETE']);
});
