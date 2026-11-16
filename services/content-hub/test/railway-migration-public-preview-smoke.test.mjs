import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPublicSyntheticPreview}
 from '../scripts/railway-migration-public-preview-smoke.mjs';
const env={RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
 RAILWAY_ENVIRONMENT_NAME:'test',BLOFY_QA_SYNTHETIC_ONLY:'1'};
test('cannot make external request outside test project',async()=>{
 let calls=0;const out=await checkPublicSyntheticPreview({
  env:{...env,RAILWAY_PROJECT_ID:'prod'},
  request:async()=>{calls++}
 });
 assert.equal(out.ok,false);assert.equal(calls,0);
});
test('public preview rejects missing health instead of falsely reporting HTTPS OK',async()=>{
 const out=await checkPublicSyntheticPreview({env,
  request:async()=>({status:502})});
 assert.equal(out.ok,false);assert.equal(out.publicHttpsVerified,false);
 assert.equal(out.stage,'health');
});
