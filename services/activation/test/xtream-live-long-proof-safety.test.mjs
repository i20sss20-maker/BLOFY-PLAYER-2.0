import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('live admin probe uses bounded extended timer while movie probes stay unchanged',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf('async function probeXtreamPlayback(');
 const end=c.indexOf('async function fetchAccount(',start);
 const body=c.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(body,/liveDiagnosticTimeoutMs\(liveDeadline-Date\.now\(\)\):9500/);
 assert.match(body,/const liveDeadline=Date\.now\(\)\+11500/);
 assert.match(body,/shouldUseIndependentSourceMedia\(/);
 assert.doesNotMatch(body,/Math\.min\(4500,liveDeadline-Date\.now\(\)\)/);
});
test('one-shot source live evidence is source-pinned, read-only and emits no credentials',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf("if(process.env.BLOFY_XTREAM_LIVE_LONG_PROOF_ON_BOOT==='1')");
 const end=c.indexOf('// Read-only, source-authorized real transport probe from the NEW STREAM',start);
 const body=c.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(body,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(body,/probeXtreamPlayback\(id,'live'\)/);
 assert.match(body,/BLOFY_XTREAM_LIVE_LONG_PROOF/);
 assert.match(body,/sourceMutation:false,subscriberCutover:false,credentialsLogged:false/);
 assert.doesNotMatch(body,/\b(?:UPDATE|DELETE|INSERT)\b|creds\.username|creds\.password|sourceUrl/);
});
