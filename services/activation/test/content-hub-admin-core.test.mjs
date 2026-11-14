import test from 'node:test';
import assert from 'node:assert/strict';
import {adminCanaryRange,HUB_MAX_CANARY_RANGE,HUB_PILOT_RUN}
 from '../src/content-hub-admin-core.mjs';

test('normal browser open ranges are capped to 8 MiB and preserve offsets',()=>{
 const bytes=2934023949;
 assert.deepEqual(adminCanaryRange(undefined,bytes),
  {from:0,to:HUB_MAX_CANARY_RANGE-1});
 assert.deepEqual(adminCanaryRange('bytes=0-',bytes),
  {from:0,to:HUB_MAX_CANARY_RANGE-1});
 assert.deepEqual(adminCanaryRange('bytes=8388608-',bytes),
  {from:8388608,to:2*HUB_MAX_CANARY_RANGE-1});
 assert.deepEqual(adminCanaryRange('bytes=0-3',bytes),
  {from:0,to:3});
 assert.deepEqual(adminCanaryRange('bytes=-4000',bytes),
  {from:bytes-4000,to:bytes-1});
 assert.deepEqual(adminCanaryRange('bytes=2934023900-',bytes),
  {from:2934023900,to:bytes-1});
});
test('multi range, negative offset, overflow and invalid pilot IDs fail closed',()=>{
 for(const input of ['bytes=-0','bytes=1-0','bytes=0-5,9-10',
  'bytes=-','bytes=999999999999999999999-','bytes=NaN-20',
  'bytes=0-3\r\nX:fake','bytes=2934023949-']){
  assert.equal(adminCanaryRange(input,2934023949),null,input);
 }
 assert.equal(adminCanaryRange('bytes=0-0',0),null);
 assert.equal(HUB_PILOT_RUN.test('abcd_1234'),true);
 assert.equal(HUB_PILOT_RUN.test('../filename'),false);
});
