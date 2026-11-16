import test from 'node:test';
import assert from 'node:assert/strict';
import {runMigrationLabAvSmoke,LAB_PROJECT,LAB_BUCKET}
  from '../scripts/railway-migration-lab-av-smoke.mjs';

const E={
 RAILWAY_PROJECT_ID:LAB_PROJECT,RAILWAY_ENVIRONMENT_NAME:'test',
 BLOFY_CONTENT_HUB_S3_BUCKET:LAB_BUCKET,BLOFY_QA_EXPECTED_BUCKET:LAB_BUCKET,
 BLOFY_CONTENT_HUB_S3_URL_STYLE:'virtual-host',
 BLOFY_QA_SYNTHETIC_ONLY:'1',BLOFY_QA_ISOLATED_BUCKET:'1',
 BLOFY_QA_SYNTHETIC_AV:'1',BLOFY_QA_PLATFORM_ENCRYPTION_DOC_ACK:'1'
};
test('migration lab refuses production project and source credentials before any I/O',async()=>{
 let calls=0;const runner=async()=>{calls++;return {ok:true}};
 const p=await runMigrationLabAvSmoke({env:{...E,RAILWAY_PROJECT_ID:'production'},
  runner});
 assert.equal(p.code,'migration_lab_wrong_project_or_environment');
 const creds=await runMigrationLabAvSmoke({env:{...E,XTREAM_PASSWORD:'secret'},runner});
 assert.equal(creds.code,'migration_lab_upstream_credentials_forbidden');
 assert.equal(calls,0);
});
test('migration lab refuses wrong bucket and absent safety flags',async()=>{
 let calls=0;const runner=async()=>{calls++;return {ok:true}};
 const b=await runMigrationLabAvSmoke({env:{...E,BLOFY_CONTENT_HUB_S3_BUCKET:'subscriber-bucket'},runner});
 assert.equal(b.code,'migration_lab_bucket_not_isolated');
 const f=await runMigrationLabAvSmoke({env:{...E,BLOFY_QA_SYNTHETIC_AV:'0'},runner});
 assert.equal(f.code,'migration_lab_approval_missing');
 assert.equal(calls,0);
});
test('migration lab permits only isolated synthetic runner and never reports cutover',async()=>{
 let calls=0;
 const r=await runMigrationLabAvSmoke({env:{...E},runner:async()=>{calls++;return {ok:true,sourceRequests:123,customerCutover:true}}});
 assert.equal(calls,1);
 assert.equal(r.ok,true);
 assert.equal(r.sourceRequests,0);
 assert.equal(r.customerCutover,false);
 assert.equal(r.scope,'BLOFY-XTREAM-MIGRATION-LAB');
});
