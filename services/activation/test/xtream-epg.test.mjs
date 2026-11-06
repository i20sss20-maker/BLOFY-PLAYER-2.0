import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeXtreamEpg} from '../src/xtream-epg.mjs';

test('real Xtream EPG preserves visible program times and clamps lengthy fields',()=>{
  const payload={epg_listings:[{
    id:'5',title:'Test Show',description:'A'.repeat(8000),
    start:'2026-11-06 20:00:00',end:'2026-11-06 21:00:00',
    start_timestamp:1794000000,stop_timestamp:1794003600,
    has_archive:1,now_playing:1,url:'https://secret.example/?password=hidden',
    random_private_data:{credential:'secret'}
  }]};
  const output=normalizeXtreamEpg(payload);
  assert.equal(output.epg_listings.length,1);
  assert.equal(output.epg_listings[0].title,'Test Show');
  assert.equal(output.epg_listings[0].description.length,4000);
  assert.equal(output.epg_listings[0].start_timestamp,1794000000);
  assert.ok(!JSON.stringify(output).includes('secret'));
  assert.equal(output.epg_listings[0].now_playing,1);
});

test('never invent EPG when provider lacks it; bounds page size',()=>{
  assert.deepEqual(normalizeXtreamEpg({success:false,error:'not available'}),{epg_listings:[]});
  assert.deepEqual(normalizeXtreamEpg(null),{epg_listings:[]});
  assert.deepEqual(normalizeXtreamEpg({epg_listings:[null,'bad',{title:'One'}]},25),
    {epg_listings:[{title:'One'}]});
  assert.equal(normalizeXtreamEpg(Array.from({length:120},(_,i)=>({id:i})),999).epg_listings.length,50);
  assert.equal(normalizeXtreamEpg([{title:'One'},{title:'Two'}],0).epg_listings.length,1);
});

test('EPG gateway resolves account-scoped live ID to real upstream source ID',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function liveEpg(');
  const end=source.indexOf('async function vodInfo(',start);
  const epg=source.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(epg,/gatewayItemById\('live',id,sourceId\)/);
  assert.match(epg,/stream_id:row.source_id/);
  assert.match(epg,/checkedFetch\(xtreamApiUrl\(row.base_url,creds.username,creds.password,action,qs\)/);
  assert.match(epg,/bytes>1024\*1024/);
  assert.match(epg,/normalizeXtreamEpg\(/);
  assert.match(epg,/return empty/);
  assert.ok(source.indexOf("const account = await authenticate(username, password",source.indexOf('async function handlePlayerApi(')) <
    source.indexOf("if (action === 'get_short_epg'"));
  assert.doesNotMatch(source,/get_short_epg' \|\| action === 'get_simple_data_table'\) return json\(res, 200, \{ epg_listings: \[\] \}/);
});
