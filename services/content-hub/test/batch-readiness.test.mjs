import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkedBatchReadiness} from '../src/chunked-pilot.mjs';

const safeEnv={
 BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_BATCH_RUN_ID:'test_batch_20261113',
 BLOFY_CONTENT_HUB_EXPECTED_BYTES:'2934023949',
 BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'123',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40)
};
test('read-only readiness names every missing gate and never exposes tokens',()=>{
 const state=chunkedBatchReadiness({});
 assert.equal(state.ready,false);
 for(const reason of ['batch_not_enabled','storage_upload_disabled',
  'source_idle_unconfirmed','source_quiet_window_unconfirmed',
  'batch_run_id_missing','approved_movie_not_selected',
  'movie_size_unconfirmed']){
  assert.ok(state.blockedBy.includes(reason),reason);
 }
 assert.equal(state.providerMediaRequests,0);
 assert.equal(state.movieTrafficChanged,false);
 assert.equal(JSON.stringify(state).includes('x'.repeat(40)),false);
});
test('readiness becomes true only when all independent flags and exact movie controls exist',()=>{
 assert.equal(chunkedBatchReadiness(safeEnv).ready,true);
 for(const key of Object.keys(safeEnv)){
  const broken={...safeEnv};
  delete broken[key];
  assert.equal(chunkedBatchReadiness(broken).ready,false,key);
 }
 assert.equal(chunkedBatchReadiness({...safeEnv,
  BLOFY_CONTENT_HUB_EXPECTED_BYTES:'0'}).ready,false);
 assert.equal(chunkedBatchReadiness({...safeEnv,
  BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH:'9'}).ready,false);
});
