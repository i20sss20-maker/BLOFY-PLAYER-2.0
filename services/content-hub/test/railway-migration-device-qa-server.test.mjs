import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMp4Range,assertSyntheticLabEnvironment}
 from '../scripts/railway-migration-device-qa-server.mjs';
const env={
 RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
 RAILWAY_ENVIRONMENT_NAME:'test',
 BLOFY_QA_SYNTHETIC_ONLY:'1'
};
test('rejects production project and all upstream credentials',()=>{
 assert.doesNotThrow(()=>assertSyntheticLabEnvironment(env));
 for(const extra of [
  {RAILWAY_PROJECT_ID:'production'},
  {RAILWAY_ENVIRONMENT_NAME:'production'},
  {BLOFY_QA_SYNTHETIC_ONLY:'0'},
  {XTREAM_PASSWORD:'secret'},
  {BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'secret'},
  {BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'secret'}
 ])assert.throws(()=>assertSyntheticLabEnvironment({...env,...extra}));
});
test('range supports full file, seek, suffix and final bytes',()=>{
 assert.deepEqual(parseMp4Range(null,100),{ok:true,status:200,from:0,to:99});
 assert.deepEqual(parseMp4Range('bytes=10-19',100),{ok:true,status:206,from:10,to:19});
 assert.deepEqual(parseMp4Range('bytes=70-',100),{ok:true,status:206,from:70,to:99});
 assert.deepEqual(parseMp4Range('bytes=-20',100),{ok:true,status:206,from:80,to:99});
 assert.deepEqual(parseMp4Range('bytes=0-999',100),{ok:true,status:206,from:0,to:99});
});
test('malformed and oversized ranges fail closed',()=>{
 for(const raw of ['bytes=100-','bytes=70-30','bytes=-0','bytes=-',
  'bytes=0-1,4-5','bytes=Infinity-','bytes=-99999999999999999999999',
  'bytes=abc-abc']){
  assert.equal(parseMp4Range(raw,100).status,416);
 }
});
