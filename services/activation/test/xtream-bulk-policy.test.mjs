import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkAccountRequest } from '../src/xtream-bulk-policy.mjs';

const now=Date.parse('2026-11-05T00:00:00Z');
const expiresAt='2026-12-05T00:00:00Z';
test('bounded account batches preserve expiry and independent connection setting',()=>{
  const info=validateBulkAccountRequest({count:10,maxConnections:2,expiresAt},now);
  assert.equal(info.count,10);
  assert.equal(info.maxConnections,2);
  assert.equal(info.expiresAt.toISOString(),expiresAt.replace('00Z','00.000Z'));
});
test('rejects missing or past expiration',()=>{
  assert.throws(()=>validateBulkAccountRequest({count:1,maxConnections:1},now),/xtream_gateway_expiry_required/);
  assert.throws(()=>validateBulkAccountRequest({count:1,maxConnections:1,expiresAt:'2026-11-01'},now),/xtream_gateway_expiry_invalid/);
});
test('does not create arbitrarily many credentials in one transaction',()=>{
  for(const count of [0,-1,11,100,1.5,Infinity]){
    assert.throws(()=>validateBulkAccountRequest({count,maxConnections:1,expiresAt},now),/xtream_gateway_bulk_count_invalid/);
  }
  for(const maxConnections of [0,-1,21,1.5,Infinity]){
    assert.throws(()=>validateBulkAccountRequest({count:1,maxConnections,expiresAt},now),/xtream_gateway_max_connections_invalid/);
  }
});
