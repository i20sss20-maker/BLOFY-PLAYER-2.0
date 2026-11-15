import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileStreamCatalogPage} from '../src/content-hub-private-mirror-reconcile-bridge.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const TOKEN='w'.repeat(45);
const items=[{kind:'movie',id:'10'},{kind:'episode',id:'127434'}];
const payload={ok:true,sourceId:SOURCE,scope:'private_manifest_database_only',
 count:2,physicalS3Checked:false,providerRequests:0,
 mediaBytesTransferred:0,customerCutover:false,automaticCopyStarted:false,
 items:[{kind:'movie',id:'10',status:'verified_manifest',
  storedManifestVerified:true,physicalS3Checked:false,
  expectedBytes:2934023949,storedBytes:2934023949},
 {kind:'episode',id:'127434',status:'not_recorded',
  storedManifestVerified:false,physicalS3Checked:false}]};
test('Portal sends only approved catalog identifiers to private Hub',async()=>{
 const calls=[];
 const out=await reconcileStreamCatalogPage({sourceId:SOURCE,items,
  hubToken:TOKEN,fetchImpl:async(url,opts)=>{
   calls.push({url,opts});
   return Response.json(payload);
  }});
 assert.equal(out.ok,true);
 assert.equal(out.items[0].status,'verified_manifest');
 assert.equal(out.items[1].status,'not_recorded');
 assert.equal(out.items[0].physicalS3Checked,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,
  'http://blofy-content-hub.railway.internal:3000/internal/mirror/verified-inventory');
 assert.equal(calls[0].opts.headers.authorization,'Bearer '+TOKEN);
 assert.equal(calls[0].opts.headers['x-blofy-owner-action'],
  'private-catalog-manifest-reconcile');
 assert.deepEqual(JSON.parse(calls[0].opts.body),{sourceId:SOURCE,items});
});
test('Portal refuses untrusted response and never fabricates stored proof',async()=>{
 for(const broken of [
  {...payload,physicalS3Checked:true},
  {...payload,sourceId:'00000000-0000-4000-8000-000000000000'},
  {...payload,customerCutover:true},
  {...payload,items:[payload.items[0],payload.items[0]]},
  {...payload,items:[{...payload.items[0],status:'magically_uploaded'},payload.items[1]]}
 ]){
  const o=await reconcileStreamCatalogPage({sourceId:SOURCE,items,hubToken:TOKEN,
   fetchImpl:async()=>Response.json(broken)});
  assert.equal(o.ok,false);
  assert.ok(o.items.every(x=>x.status==='not_assessed'));
 }
});
test('Portal blocks unsafe IDs and cannot route to arbitrary media URLs',async()=>{
 let requests=0;
 const o=await reconcileStreamCatalogPage({sourceId:SOURCE,
  items:[{kind:'movie',id:'https://evil.invalid/a'}],hubToken:TOKEN,
  fetchImpl:async()=>{requests++;return Response.json(payload)}});
 assert.equal(o.ok,false);
 assert.equal(o.code,'stream_manifest_scope_invalid');
 assert.equal(requests,0);
});
test('Portal handles Hub feature-off and network failure without false S3 claims',async()=>{
 const off=await reconcileStreamCatalogPage({sourceId:SOURCE,items,hubToken:TOKEN,
  fetchImpl:async()=>new Response(null,{status:404})});
 assert.equal(off.code,'stream_manifest_feature_off');
 assert.equal(off.items[0].storedManifestVerified,false);
 const broken=await reconcileStreamCatalogPage({sourceId:SOURCE,items,hubToken:TOKEN,
  fetchImpl:async()=>{throw Error('private network unavailable')}});
 assert.equal(broken.code,'stream_manifest_bridge_failed');
 assert.ok(broken.items.every(x=>x.physicalS3Checked===false));
});
test('gated integration does not allow owner catalog to start auto media transfers',async()=>{
 const {readFile}=await import('node:fs/promises');
 const p=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const s=await readFile(new URL('../../content-hub/src/server.mjs',import.meta.url),'utf8');
 assert.match(p,/BLOFY_STREAM_MIRROR_MANIFEST_RECONCILE_ENABLED/);
 assert.match(s,/BLOFY_CONTENT_HUB_MIRROR_RECONCILE_ENABLED/);
 assert.match(s,/private-catalog-manifest-reconcile/);
 assert.match(s,/physicalS3Checked:false/);
});
