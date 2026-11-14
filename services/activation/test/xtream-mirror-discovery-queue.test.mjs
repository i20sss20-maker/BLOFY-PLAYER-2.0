import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createXtreamMirrorDiscoveryStore,normalizeMirrorDiscoveryCandidate,
 riyadhMirrorDay
} from '../src/xtream-mirror-discovery-queue.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
function fixture(movieRows=[{gateway_id:1,media_id:'film01',extension:'mp4',
 title:'Movie One'},{gateway_id:3,media_id:'film02',extension:'mkv',
 title:'Movie Two'}],episodes=[]){
 const calls=[],seen=[],cursors=new Map(),posted=[];
 const client={
  async query(sql,args=[]){
   calls.push({sql,args});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')
    return {rowCount:0,rows:[]};
   if(sql.includes('SELECT id FROM blofy_xtream_servers'))
    return {rows:[{id:ID}]};
   if(sql.includes('INSERT INTO blofy_xtream_mirror_discovery'))
    return {rowCount:1};
   if(sql.includes('FROM blofy_xtream_mirror_discovery')&&
      sql.includes('FOR UPDATE')){
    return {rows:[cursors.get(args[1])||{
     cursor_id:0,scan_started_day:null,completed_local_day:null}]};
   }
   if(sql.includes('FROM blofy_xtream_gateway_item_map m')&&
      sql.includes('SELECT m.gateway_id')){
    return {rows:movieRows.filter(r=>r.gateway_id>args[1]).slice(0,args[2])};
   }
   if(sql.includes('FROM blofy_xtream_gateway_episode_map e')&&
      sql.includes('SELECT e.gateway_id')){
    return {rows:episodes.filter(r=>r.gateway_id>args[1]).slice(0,args[2])};
   }
   if(sql.includes('INSERT INTO blofy_xtream_mirror_items')){
    const r=JSON.parse(args[2]);
    posted.push(...r);seen.push(r);
    return {rowCount:r.length};
   }
   if(sql.includes('UPDATE blofy_xtream_mirror_discovery')){
    const prev=cursors.get(args[1])||{};
    cursors.set(args[1],{
      cursor_id:args[2],
      scan_started_day:args[5]||!prev.scan_started_day?args[4]:prev.scan_started_day,
      completed_local_day:args[3]?args[4]:prev.completed_local_day||null
    });
    return {rowCount:1};
   }
   throw Error('unexpected SQL '+sql.slice(0,80));
  },
  release(){}
 };
 const db={
  connect:async()=>client,
  query:async(sql,args=[])=>{
   if(sql.startsWith('CREATE')||sql.startsWith('ALTER'))return {rowCount:0};
   if(sql.includes('SELECT gateway_id,media_id,extension,title')){
    return {rows:posted.filter(x=>x.gateway_id>args[2]).slice(0,args[4])
      .map(x=>({...x,state:'needs_review',
        mapping_conflict:false,expected_bytes:null}))};
   }
   if(sql.includes('GROUP BY media_kind,state'))return {rows:[
    {media_kind:'movie',state:'needs_review',total:String(posted.length)}]};
   if(sql.includes('SELECT media_kind,cursor_id'))return {rows:[...cursors.entries()]
    .map(([media_kind,v])=>({media_kind,...v}))};
   throw Error('unexpected top-level SQL '+sql.slice(0,80));
  }
 };
 return {store:createXtreamMirrorDiscoveryStore(db),
  calls,seen,cursors,posted};
}

test('valid candidates normalize identity without fetching media or licensing them',()=>{
 assert.deepEqual(normalizeMirrorDiscoveryCandidate({
  gateway_id:11,media_id:'100',extension:'MP4',
  title:'  A film  '
 },'movie'),{gatewayId:11,mediaId:'100',extension:'mp4',
  mediaKind:'movie',seriesMediaId:null,title:'A film'});
 assert.equal(normalizeMirrorDiscoveryCandidate({
  gateway_id:0,media_id:'x',extension:'mp4'
 },'movie'),null);
 assert.equal(riyadhMirrorDay(new Date('2026-11-13T22:30:00Z')),
  '2026-11-14');
});

test('durable keyset movie scan continues until full pass, avoids daily re-import',async()=>{
 const f=fixture();
 const one=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14',limit:1});
 assert.equal(one.hasMore,true);
 assert.equal(one.scanned,1);
 assert.equal(one.lastGatewayId,1);
 const two=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14',limit:1});
 assert.equal(two.lastGatewayId,3);
 const final=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14',limit:1});
 assert.equal(final.code,'mirror_scan_pass_completed');
 assert.equal(final.scanned,0);
 const duplicate=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14',limit:1});
 assert.equal(duplicate.code,'mirror_scan_already_complete_today');
 assert.equal(f.posted.length,2);
 assert.equal(f.posted[0].gateway_id,1);
 assert.equal(f.posted[1].gateway_id,3);
 const next=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-15',limit:1});
 assert.equal(next.lastGatewayId,1);
 assert.equal(next.hasMore,true);
 // After the first page of a new day's rescan, the next tick must
 // advance to gateway 3 rather than restarting gateway 1 forever.
 const nextSecond=await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-15',limit:1});
 assert.equal(nextSecond.lastGatewayId,3);
 assert.equal(nextSecond.hasMore,true);
 const report=await f.store.summary({sourceId:ID});
 assert.equal(report.allMediaFilesCopied,false);
 assert.equal(report.episodesOnlyMappedSubset,true);
 assert.equal(report.providerRequests,0);
 assert.equal(report.queue[0].state,'needs_review');
});

test('mapped episode subset can be discovered but never claims all provider episodes',async()=>{
 const f=fixture([],[
  {gateway_id:50,media_id:'ep45',series_media_id:'show32',
   extension:'ts',title:'Series'},
  {gateway_id:51,media_id:'bad/episode',series_media_id:'show32',
   extension:'mp4',title:'Series'}]);
 const result=await f.store.scanPage({sourceId:ID,
  mediaKind:'episode',localDay:'2026-11-14',limit:5});
 assert.equal(result.code,'mirror_scan_pass_completed');
 assert.equal(result.scanned,2);
 assert.equal(result.discoverable,1);
 assert.equal(result.invalidCandidates,1);
 assert.equal(f.posted[0].series_media_id,'show32');
 assert.equal(f.posted[0].media_id,'ep45');
 assert.equal(f.posted[0].title,'Series');
});

test('invalid source or local day cannot contact database',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.store.scanPage({sourceId:'notuuid',
  mediaKind:'movie',localDay:'2026-11-14'}),/request_invalid/);
 await assert.rejects(()=>f.store.scanPage({sourceId:ID,
  mediaKind:'live',localDay:'2026-11-14'}),/request_invalid/);
 await assert.rejects(()=>f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-14-14'}),/request_invalid/);
 assert.equal(f.calls.length,0);
});

test('source is rejected before touching queue if not approved and fresh',async()=>{
 const f=fixture();
 let rolledBack=false;
 const db={
  query:async()=>({rowCount:0}),
  connect:async()=>({query:async sql=>{
   if(sql.includes('SELECT id FROM blofy_xtream_servers'))return {rows:[]};
   if(sql==='ROLLBACK')rolledBack=true;
   return {rowCount:0};
  },release(){}})
 };
 const store=createXtreamMirrorDiscoveryStore(db);
 const r=await store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14'});
 assert.equal(r.code,'mirror_source_not_currently_approved');
 assert.equal(rolledBack,true);
 assert.equal(r.mediaBytesTransferred,0);
});

test('admin can inspect paginated discovered items but cannot start copy',async()=>{
 const f=fixture();
 await f.store.scanPage({sourceId:ID,
  mediaKind:'movie',localDay:'2026-11-14',limit:20});
 const page=await f.store.listQueue({sourceId:ID,mediaKind:'movie',limit:1});
 assert.equal(page.items.length,1);
 assert.equal(page.items[0].gatewayId,1);
 assert.equal(page.items[0].mappingConflict,false);
 assert.equal(page.items[0].expectedBytes,null);
 assert.equal(page.items[0].sizeVerified,false);
 assert.equal(page.hasMore,true);
 assert.equal(page.nextCursor,1);
 assert.equal(page.mediaBytesTransferred,0);
 const other=await f.store.listQueue({sourceId:ID,
  mediaKind:'movie',afterGatewayId:1,limit:1});
 assert.equal(other.items[0].gatewayId,3);
 await assert.rejects(()=>f.store.listQueue({sourceId:ID,
  mediaKind:'live'}),/queue_query_invalid/);
});
