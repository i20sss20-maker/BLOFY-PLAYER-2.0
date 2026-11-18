import test from 'node:test';
import assert from 'node:assert/strict';
import {parseXtreamCatalogDeltaRequest,xtreamCatalogDeltaPage} from '../src/xtream-catalog-delta.mjs';

const SOURCE='fab89cd2-1234-4abc-8def-abcabcabcabc';
function dbFixture({changed=true,kind='items',deleted=false,revision=7}={}){
 const calls=[];
 const db={query:async(text,values)=>{
  calls.push({text,values});
  if(text.includes('blofy_xtream_catalog_revisions v')){
   return {rows:[{enabled:true,publish_catalog:true,status:'online',
    revision,updated_at:'2026-11-18T09:00:00Z'}]};
  }
  if(text.includes('xtream_catalog_revision_history'))return {rows:[
    {updated_at:'2026-11-17T10:00:00Z'}
  ]};
  if(text.includes('blofy_xtream_catalog_removals d'))
    return {rows:deleted?[{gateway_id:'80'}]:[]};
  if(text.includes('blofy_xtream_gateway_category_map m')&&
    text.includes('JOIN blofy_xtream_categories c'))return {rows:[
      {gateway_id:'17',name:'New Channels'}
    ]};
  if(text.includes('FROM blofy_xtream_gateway_item_map m'))
    return {rows:changed?[{gateway_id:'31',server_id:SOURCE,
      source_id:'99',category_id:'3',name:'New Film',
      category_gateway_id:'17',icon_url:'',metadata:{},featured:false,
      container_extension:'mp4',channel_number:null}]:[]};
  throw Error('unexpected SQL');
 }};
 return {db,calls};
}
test('only strict request shapes are accepted',()=>{
 assert.deepEqual(parseXtreamCatalogDeltaRequest({
  kind:'movie',part:'items',since:'4',revision:'5',after:'0'
 }),{kind:'movie',part:'items',since:4,revision:5,after:0});
 for(const params of [
  {kind:'movie',part:'items',since:'4',revision:'5',after:'-1'},
  {kind:'live',part:'items',since:'secret',revision:'5',after:'0'},
  {kind:'movie',part:'tables',since:'4',revision:'5',after:'0'},
  {kind:'bad',part:'items',since:'4',revision:'5',after:'0'}
 ])assert.equal(parseXtreamCatalogDeltaRequest(params),null);
});
test('account-owned source is never accepted as a query override',async()=>{
 const {db,calls}=dbFixture();
 const result=await xtreamCatalogDeltaPage(db,'other-source',{
  kind:'movie',part:'items',since:'6',revision:'7',after:'0'});
 assert.equal(result.status,400);
 assert.equal(calls.length,0);
});
test('same revision requires no item queries',async()=>{
 const {db,calls}=dbFixture();
 const result=await xtreamCatalogDeltaPage(db,SOURCE,{
  kind:'series',part:'items',since:'7',revision:'7',after:'0'});
 assert.equal(result.ok,true);
 assert.deepEqual(result.items,[]);
 assert.equal(calls.length,1);
});
test('only changed, stable source-scoped and parameterized items are returned',async()=>{
 const {db,calls}=dbFixture();
 const result=await xtreamCatalogDeltaPage(db,SOURCE,{
  kind:'movie',part:'items',since:'6',revision:'7',after:'0'
 },{hiddenIds:new Set()});
 assert.equal(result.ok,true);
 assert.equal(result.items[0].stream_id,31);
 assert.equal(result.items[0].name,'New Film');
 assert.equal(result.complete,true);
 assert.equal(calls.at(-1).values[0],SOURCE);
 assert.equal(calls.at(-1).values[1],'movie');
 assert.match(calls.at(-1).text,/updated_at/);
 assert.doesNotMatch(JSON.stringify(result),/server_id|source_id|username|password|http:\/\//i);
});
test('distributor hidden titles are filtered before response',async()=>{
 const {db}=dbFixture();
 const result=await xtreamCatalogDeltaPage(db,SOURCE,{
  kind:'movie',part:'items',since:'6',revision:'7',after:'0'
 },{hiddenIds:new Set(['99'])});
 assert.equal(result.ok,true);
 assert.deepEqual(result.items,[]);
});
test('deleted content uses stable gateway IDs without identifying upstream',async()=>{
 const {db}=dbFixture({deleted:true});
 const result=await xtreamCatalogDeltaPage(db,SOURCE,{
  kind:'series',part:'removed',since:'6',revision:'7',after:'0'});
 assert.deepEqual(result.items,[80]);
});
test('revision changes force an explicit retry rather than mixed pages',async()=>{
 const {db}=dbFixture({revision:8});
 const result=await xtreamCatalogDeltaPage(db,SOURCE,{
  kind:'live',part:'items',since:'6',revision:'7',after:'0'});
 assert.equal(result.status,409);
 assert.equal(result.code,'catalog_delta_revision_changed');
});
