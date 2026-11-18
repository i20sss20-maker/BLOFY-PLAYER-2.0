import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ensureRevisionAwareGatewayMap} from '../src/xtream-gateway-map-revision-cache.mjs';

test('100 concurrent Xtream clients share one bounded full mapping job',async()=>{
  const cache=new Map();
  let clock=100,revision='23',reads=0,scans=0;
  const getRevision=async()=>{reads++;return revision;};
  const map=async()=>{scans++;return {mapped:scans};};
  const access=()=>ensureRevisionAwareGatewayMap(cache,'series:saleh',map,getRevision,
    {now:()=>clock,ttlMs:60000});
  const batch=await Promise.all(Array.from({length:100},access));
  assert.equal(scans,1);assert.equal(reads,1);
  assert.ok(batch.every(x=>x.mapped===1));
  clock+=60001;
  await Promise.all(Array.from({length:100},access));
  assert.equal(scans,1,'stable catalog version must avoid full 290k map');
  assert.equal(reads,2,'revision read remains single-flight');
  revision='24';clock+=60001;
  const updated=await Promise.all(Array.from({length:100},access));
  assert.ok(updated.every(x=>x.mapped===2));
  assert.equal(scans,2);assert.equal(reads,3);
});
test('missing or failing revision counter conservatively rebuilds maps',async()=>{
 const cache=new Map();let now=100,scans=0;
 const map=async()=>++scans;
 await ensureRevisionAwareGatewayMap(cache,'movie:a',map,async()=>null,{now:()=>now,ttlMs:5});
 now+=6;
 await ensureRevisionAwareGatewayMap(cache,'movie:a',map,async()=>{throw Error('no_revision_table')},
   {now:()=>now,ttlMs:5});
 assert.equal(scans,2);
 now+=6;
 await ensureRevisionAwareGatewayMap(cache,'movie:a',map,async()=> '0',{now:()=>now,ttlMs:5});
 assert.equal(scans,3);
});
test('failed map is not cached and a subsequent request can recover',async()=>{
 const cache=new Map();let attempt=0;
 const work=async()=>{attempt++;if(attempt===1)throw Error('db transient');return 'ok'};
 await assert.rejects(ensureRevisionAwareGatewayMap(cache,'live:a',work,async()=> '24'),/db transient/);
 assert.equal(cache.size,0);
 assert.equal(await ensureRevisionAwareGatewayMap(cache,'live:a',work,async()=> '24'),'ok');
});
test('gateway maps keep source auth, revision checks and stable on-conflict IDs',async()=>{
 const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(src,/ensureRevisionAwareGatewayMap/);
 assert.match(src,/FROM blofy_xtream_servers s\s+LEFT JOIN blofy_xtream_catalog_revisions v/);
 assert.match(src,/s\.enabled=TRUE AND s\.publish_catalog=TRUE/);
 assert.match(src,/ON CONFLICT\(server_id,media_type,source_id\) DO NOTHING/);
 assert.match(src,/ON CONFLICT\(server_id,media_type,source_category_id\) DO NOTHING/);
 assert.match(src,/oncePerMediaMap\(itemMapJobs,key,[\s\S]*?sourceId\);/);
 assert.doesNotMatch(src,/DELETE FROM blofy_xtream_gateway_item_map/);
});
