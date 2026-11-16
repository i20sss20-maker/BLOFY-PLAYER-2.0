import test from 'node:test';
import assert from 'node:assert/strict';
import {runIsolatedMirrorPgS3} from '../scripts/railway-mirror-pg-s3-qa.mjs';

const SAFE={
 BLOFY_QA_SYNTHETIC_ONLY:'1',
 BLOFY_QA_SYNTHETIC_AV:'1',
 BLOFY_QA_ISOLATED_BUCKET:'1',
 BLOFY_QA_REAL_PG_MIRROR:'1',
 BLOFY_QA_EXPECTED_BUCKET:'blofy-mirror-s3-isolated-qa',
 BLOFY_CONTENT_HUB_S3_BUCKET:'blofy-mirror-s3-isolated-qa',
 BLOFY_QA_PG_CONNECTION_URL:
  'postgresql://qa:local-test@postgres-ao7c.railway.internal:5432/railway',
 BLOFY_QA_EXPECTED_PG_HOST:'postgres-ao7c.railway.internal',
 BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://t3.storageapi.dev',
 BLOFY_CONTENT_HUB_S3_URL_STYLE:'virtual-host'
};
test('isolated real PG+S3 runner denies misconfigured DB/bucket/authorization before I/O',async()=>{
 let calls=0;
 for(const [changes,expected] of [
  [{BLOFY_QA_SYNTHETIC_ONLY:'0'},'qa_integration_not_authorized'],
  [{BLOFY_QA_SYNTHETIC_AV:'0'},'qa_integration_not_authorized'],
  [{BLOFY_QA_REAL_PG_MIRROR:'0'},'qa_integration_not_authorized'],
  [{BLOFY_QA_ISOLATED_BUCKET:'0'},'qa_integration_not_authorized'],
  [{BLOFY_CONTENT_HUB_S3_BUCKET:'blofy-content-hub-private'},
   'qa_integration_bucket_not_isolated'],
  [{BLOFY_QA_EXPECTED_BUCKET:'blofy-content-hub-private'},
   'qa_integration_bucket_not_isolated'],
  [{BLOFY_QA_PG_CONNECTION_URL:
   'postgresql://qa:local-test@postgres.railway.internal:5432/railway'},
   'qa_integration_database_not_isolated'],
  [{BLOFY_QA_EXPECTED_PG_HOST:'postgres.railway.internal'},
   'qa_integration_database_not_isolated'],
  [{BLOFY_QA_PG_CONNECTION_URL:
   'postgresql://qa:local-test@evil.example:5432/railway'},
   'qa_integration_database_not_isolated'],
  [{BLOFY_CONTENT_HUB_S3_ENDPOINT:'http://127.0.0.1:9000'},
   'qa_integration_s3_endpoint_invalid'],
  [{BLOFY_CONTENT_HUB_S3_URL_STYLE:'path'},
   'qa_integration_s3_endpoint_invalid']
 ]){
  const result=await runIsolatedMirrorPgS3({
   env:{...SAFE,...changes},
   makeStorage:()=>{calls++;throw Error('never-open-storage')},
   makeLease:()=>{calls++;throw Error('never-open-lease')},
   createPool:()=>{calls++;throw Error('never-open-postgres')},
   buildMedia:()=>{calls++;throw Error('never-generate-media')}
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,expected,JSON.stringify(changes));
  assert.equal(result.sourceRequestsToXtream,0);
  assert.equal(result.customerCutover,false);
  assert.equal(result.movieVerified,false);
  assert.equal(result.episodeVerified,false);
 }
 assert.equal(calls,0);
});
test('the PG/S3 runner fails closed if private QA bucket is not empty',async()=>{
 let gen=0,db=0;
 const result=await runIsolatedMirrorPgS3({
  env:SAFE,
  makeStorage:()=>({measurePrivateUsage:async()=>({
   ok:true,usageExact:true,verifiedPrivateBucket:true,
   usedBytes:100,objectCount:1
  })}),
  createPool:()=>{db++;throw Error('must-not-create-postgres')},
  buildMedia:()=>{gen++;throw Error('must-not-generate-video')}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'qa_integration_cleanup_unverified');
 assert.equal(result.sourceRequestsToXtream,0);
 assert.equal(gen,0);
 assert.equal(db,0);
});
