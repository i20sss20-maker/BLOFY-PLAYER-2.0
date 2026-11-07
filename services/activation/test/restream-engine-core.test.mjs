import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrivateRestreamOrigin,publicRestreamState} from '../src/restream-engine-core.mjs';

test('accepts private Railway engine with explicit port only',()=>{
 assert.equal(normalizePrivateRestreamOrigin('http://blofy-restream-engine.railway.internal:8888/'),'http://blofy-restream-engine.railway.internal:8888');
 assert.equal(normalizePrivateRestreamOrigin(''),null);
});
test('refuses public, credentialed, relative, pathful, and insecure origins',()=>{
 for(const url of ['https://host.up.railway.app:8888/','http://example.com:8888/','http://127.0.0.1:8888/','http://user:pass@engine.railway.internal:8888/','http://engine.railway.internal:8888/secret','http://engine.railway.internal:8888/?url=https://evil.com','http://engine.railway.internal:80/']) {
  assert.throws(()=>normalizePrivateRestreamOrigin(url),{message:/blofy_restream_engine_invalid_private_url|Invalid URL/});
 }
});
test('service response does not imply playable content',()=>{
 const status=publicRestreamState({configured:true,responded:true,httpStatus:404,elapsedMs:43});
 assert.deepEqual(status,{configured:true,connected:true,state:'online',playbackVerified:false,httpStatus:404,elapsedMs:43});
});
test('returns degraded status without exposing engine hostname',()=>{
 assert.deepEqual(publicRestreamState({configured:true,responded:false}),{configured:true,connected:false,state:'unreachable',playbackVerified:false,httpStatus:null,elapsedMs:null});
});
