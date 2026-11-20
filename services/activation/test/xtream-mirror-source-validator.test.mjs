import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mirrorSourceValidatorHash}
 from '../src/xtream-mirror-source-validator.mjs';

test('strong ETag produces an exact bounded SHA-256 of canonical stream version',()=>{
 const result=mirrorSourceValidatorHash(new Headers({
  etag:'"binary-version-1"',
  'last-modified':'Mon, 16 Nov 2026 00:00:00 GMT'}));
 const expected=createHash('sha256')
  .update('etag:"binary-version-1"','utf8').digest('hex');
 assert.equal(result,expected);
 assert.ok(!result.includes('binary-version'));
});
test('weak ETag without last-modified is blocked; fallback is deterministic',()=>{
 const weak=mirrorSourceValidatorHash(new Headers({
  etag:'W/"unstable-cache"'}));
 assert.equal(weak,null);
 const backup=mirrorSourceValidatorHash(new Headers({
  etag:'W/"unstable-cache"',
  'last-modified':'Mon, 16 Nov 2026 00:00:00 GMT'}));
 assert.equal(backup,createHash('sha256')
  .update('modified:Mon, 16 Nov 2026 00:00:00 GMT','utf8')
  .digest('hex'));
});
test('reject absent, oversized, CR/LF or unreadable source version',()=>{
 for(const headers of [new Headers(),new Headers({etag:'x'.repeat(160)})]){
  assert.equal(mirrorSourceValidatorHash(headers),null);
 }
 assert.equal(mirrorSourceValidatorHash(null),null);
 assert.equal(mirrorSourceValidatorHash({get:()=>'"bad\nversion"'}),null);
 assert.equal(mirrorSourceValidatorHash({get:()=>'"bad\rversion"'}),null);
});
