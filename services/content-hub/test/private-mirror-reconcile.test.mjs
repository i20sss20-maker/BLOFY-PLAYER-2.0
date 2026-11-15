import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePrivateVerifiedManifests} from '../src/private-mirror-reconcile.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const sha='f'.repeat(64);
function fixture(){
 const calls=[];
 const db={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes('FROM blofy_content_hub_chunk_runs'))return {rows:[
   {media_id:'10',state:'verified',expected_bytes:'2934023949',
    bytes_copied:'2934023949',verified_sha256:sha,
    chunk_count:350,extension:'mkv'},
   {media_id:'11',state:'staged',expected_bytes:'9000000',
    bytes_copied:'2000000',verified_sha256:null,
    chunk_count:1,extension:'mp4'}
  ]};
  if(sql.includes('FROM blofy_content_hub_episode_runs'))return {rows:[
   {gateway_id:127434,state:'verified',expected_bytes:'1444843431',
    bytes_copied:'1444843431',verified_sha256:sha,
    chunk_count:173,extension:'mkv'}
  ]};
  throw Error('unexpected table');
 }};
 return {db,calls};
}
test('catalog IDs reconcile with completed movie and episode manifests without S3/ Xtream calls',async()=>{
 const {db,calls}=fixture();
 const o=await reconcilePrivateVerifiedManifests(db,{sourceId:SOURCE,
  items:[{kind:'movie',id:'10'},{kind:'movie',id:'11'},
    {kind:'movie',id:'12'},{kind:'episode',id:'127434'}]});
 assert.equal(o.ok,true);
 assert.equal(o.count,4);
 assert.equal(o.manifestVerifiedCount,2);
 assert.equal(o.notRecordedCount,1);
 assert.equal(o.items[0].status,'verified_manifest');
 assert.equal(o.items[0].storedManifestVerified,true);
 assert.equal(o.items[0].physicalS3Checked,false);
 assert.equal(o.items[0].chunks,350);
 assert.equal(o.items[1].status,'copy_incomplete');
 assert.equal(o.items[2].status,'not_recorded');
 assert.equal(o.items[3].status,'verified_manifest');
 assert.equal(o.providerRequests,0);assert.equal(o.mediaBytesTransferred,0);
 assert.equal(o.customerCutover,false);assert.equal(o.automaticCopyStarted,false);
 assert.equal(calls.length,2);
 assert.ok(calls[0].sql.includes('source_id=$1'));
 assert.ok(calls[1].sql.includes('source_id=$1'));
 assert.equal(calls[0].params[0],SOURCE);
 assert.equal(calls[1].params[0],SOURCE);
});
test('fails closed on oversized untrusted requests and source injection',async()=>{
 const {db,calls}=fixture();
 for(const args of [
  {sourceId:'x',items:[{kind:'movie',id:'10'}]},
  {sourceId:SOURCE,items:[]},
  {sourceId:SOURCE,items:Array.from({length:51},(_,n)=>({kind:'movie',id:String(n)}))},
  {sourceId:SOURCE,items:[{kind:'movie',id:"12' OR 1=1"}]},
  {sourceId:SOURCE,items:[{kind:'episode',id:'../1'}]},
  {sourceId:SOURCE,items:[{kind:'movie',id:'10'},{kind:'movie',id:'10'}]}
 ])await assert.rejects(()=>reconcilePrivateVerifiedManifests(db,args),
   /private_reconcile_/);
 assert.equal(calls.length,0);
});
test('missing private copy tables are not mistaken for unverified physical S3',async()=>{
 const calls=[];
 const db={async query(sql){
  calls.push(sql);throw Object.assign(Error('missing'),{code:'42P01'});
 }};
 const o=await reconcilePrivateVerifiedManifests(db,{sourceId:SOURCE,
  items:[{kind:'movie',id:'100'},{kind:'episode',id:'9'}]});
 assert.equal(o.ok,true);
 assert.equal(o.notRecordedCount,2);
 assert.equal(o.physicalS3Checked,false);
 assert.equal(calls.length,2);
});
test('inconsistent verified row is not treated as a safe copy',async()=>{
 const db={query:async()=>({rows:[{media_id:'10',state:'verified',
  extension:'mkv',expected_bytes:'12000',
  bytes_copied:'12000',verified_sha256:'bad',chunk_count:2}]})};
 const o=await reconcilePrivateVerifiedManifests(db,{sourceId:SOURCE,
  items:[{kind:'movie',id:'10'}]});
 assert.equal(o.items[0].status,'verification_inconsistent');
 assert.equal(o.items[0].storedManifestVerified,false);
});
