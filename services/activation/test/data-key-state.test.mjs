import test from 'node:test';
import assert from 'node:assert/strict';
import { dataKeyFingerprint, wrapDataKey, unwrapDataKey } from '../src/data-key-state.mjs';

const dataKey='a'.repeat(64);
const wrappingKey='b'.repeat(64);

test('production data key is authenticated and recoverable only with the Azure wrapping key',()=>{
  const wrapped=wrapDataKey(dataKey,wrappingKey);
  assert.match(wrapped,/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(unwrapDataKey(wrapped,wrappingKey),dataKey);
  assert.match(dataKeyFingerprint(dataKey),/^[a-f0-9]{64}$/);
  assert.throws(()=>unwrapDataKey(wrapped,'c'.repeat(64)),/wrapped_data_key_decryption_failed/);
});

test('tampering with persisted wrapped data is rejected',()=>{
  const wrapped=wrapDataKey(dataKey,wrappingKey);
  const parts=wrapped.split('.');
  const data=Buffer.from(parts[3],'base64url');
  data[0]^=1;
  parts[3]=data.toString('base64url');
  assert.throws(()=>unwrapDataKey(parts.join('.'),wrappingKey),/wrapped_data_key_decryption_failed/);
});

test('invalid data and wrapping keys fail closed',()=>{
  assert.throws(()=>wrapDataKey('bad',wrappingKey),/data_key_invalid/);
  assert.throws(()=>wrapDataKey(dataKey,'bad'),/data_key_wrapping_key_invalid/);
  assert.throws(()=>unwrapDataKey('not-a-wrapper',wrappingKey),/wrapped_data_key_invalid/);
});
