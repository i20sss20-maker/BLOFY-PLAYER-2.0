import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mediaRetryDelayMs,waitXtreamMediaRetry} from '../src/xtream-media-retry-backoff.mjs';

test('transient retry uses capped randomized delay, not synchronized immediate retry',()=>{
 assert.equal(mediaRetryDelayMs(1,()=>0),490);
 assert.equal(mediaRetryDelayMs(1,()=>1),910);
 assert.equal(mediaRetryDelayMs(2,()=>0),980);
 assert.equal(mediaRetryDelayMs(99,()=>1),2340);
 assert.equal(mediaRetryDelayMs(1,()=>Number.NaN),700);
});
test('aborted clients do not start another upstream request after retry delay',async()=>{
 const pre=new AbortController();pre.abort();
 assert.equal(await waitXtreamMediaRetry({attempt:1,signal:pre.signal}),false);
 const ctl=new AbortController();
 const result=waitXtreamMediaRetry({attempt:1,signal:ctl.signal,random:()=>0});
 setTimeout(()=>ctl.abort(),5);
 assert.equal(await result,false);
});
test('normal delay permits exactly one caller-managed retry',async()=>{
 const result=await waitXtreamMediaRetry({attempt:1,random:()=>0});
 assert.equal(result,true);
});
test('only pre-response retry paths use jitter; never replay a partially streamed response',async()=>{
 const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const block=src.slice(src.indexOf('async function proxyMedia('),
  src.indexOf('async function handleAuthorizedXtreamHls('));
 assert.match(block,/if \(retryable && !transientRetried && attempt < maxAttempts\) \{[\s\S]*?waitXtreamMediaRetry/);
 assert.match(block,/if \(!res.headersSent && !transientRetried && attempt < maxAttempts/);
 assert.match(block,/if\(!\(await waitXtreamMediaRetry\(\{attempt,signal:client.signal\}\)\)\)return;/);
 assert.match(block,/if\(res.headersSent\)closedTelemetryRecorded=true/);
 assert.match(block,/if \(!res.destroyed\) res.destroy\(\)/);
 assert.equal((block.match(/waitXtreamMediaRetry\(\{attempt,signal:client.signal\}\)/g)||[]).length,2);
});
