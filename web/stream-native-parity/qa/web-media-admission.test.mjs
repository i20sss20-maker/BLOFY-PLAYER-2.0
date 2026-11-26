import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyWebMediaAdmission as c} from '../web-media-admission.mjs';
test('shared relay busy preserves 503 and bounded retry wait',()=>{
 assert.deepEqual(c(503,'3'),{status:503,error:'hls_origin_backoff',retryAfterSeconds:3});
 assert.deepEqual(c(429,'8'),{status:429,error:'media_upstream_busy',retryAfterSeconds:8});
 for(const value of ['999','0','-1','https://secret.invalid','1.5',null])assert.equal(c(503,value).retryAfterSeconds,5);
});
test('authorization and hidden catalog failures do not become retryable media errors',()=>{
 assert.deepEqual(c(401,'3'),{status:401,error:'invalid_session'});
 assert.deepEqual(c(403,'3'),{status:403,error:'invalid_session'});
 assert.deepEqual(c(404,'3'),{status:404,error:'media_missing'});
 assert.deepEqual(c(307,'3'),{status:502,error:'media_redirect_unsupported'});
});
test('media worker cancels rejected body and forwards bounded retry hint',()=>{
 const s=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
 assert.match(s,/classifyWebMediaAdmission\(status,upstream\.headers\.get\('retry-after'\)\)/);
 assert.match(s,/await upstream\.body\?\.cancel\(\)/);
 assert.match(s,/start\.retryAfterSeconds\?\?/);
});
