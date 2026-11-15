import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSiteQaRange,SITE_QA_MAX_RANGE} from '../src/site-qa-range.mjs';
const MiB=1024*1024;
test('owner website original-file range parser reads at most 8 MiB',()=>{
 assert.deepEqual(parseSiteQaRange(undefined,300*MiB),{from:0,to:8*MiB-1});
 assert.deepEqual(parseSiteQaRange('bytes=0-',300*MiB),{from:0,to:8*MiB-1});
 assert.deepEqual(parseSiteQaRange('bytes=1048576-',300*MiB),{from:MiB,to:9*MiB-1});
 assert.deepEqual(parseSiteQaRange('bytes=-1024',300*MiB),{from:300*MiB-1024,to:300*MiB-1});
 assert.deepEqual(parseSiteQaRange('bytes=104-115',300*MiB),{from:104,to:115});
 assert.deepEqual(parseSiteQaRange('bytes=0-',1024),{from:0,to:1023});
 assert.equal(SITE_QA_MAX_RANGE,8*MiB);
});
test('website route rejects malformed, ambiguous, oversized and invalid ranges',()=>{
 const total=100*MiB;
 for(const raw of ['bytes=0-8388608','bytes=0-1,4-7',
    'bytes=000-2','bytes=9-8','bytes=1000000000-',
    'bytes=0-1000000000','bytes=-8388609','bytes=-0',
    'bytes=0- 100','bytes=0-1\nrange: x','bytes=2-1','items=0-10']){
  assert.equal(parseSiteQaRange(raw,total),null,raw);
 }
 assert.equal(parseSiteQaRange('bytes=0-',0),null);
 assert.equal(parseSiteQaRange('bytes=0-',4*1024**3+1),null);
 assert.equal(parseSiteQaRange('bytes=0-',Number.MAX_SAFE_INTEGER),null);
});
test('website original-file server route enforces exact run, feature flag and verified S3',async()=>{
 // Regression contract from the owner-only Hub route. This test never
 // opens real upstream provider media and never changes customer routes.
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(src,/BLOFY_CONTENT_HUB_WEBSITE_FULL_RANGE_QA_ENABLED/);
 assert.match(src,/siteQa\[2\]!==String/);
 assert.match(src,/private-original-range-qa/);
 assert.match(src,/getVerifiedEpisodeObject/);
 assert.match(src,/getVerifiedChunkedObject/);
 assert.match(src,/parseSiteQaRange\(req\.headers\.range,saved\.bytes\)/);
 assert.match(src,/siteQa\?siteQa\[1\]==='episode'/);
});
