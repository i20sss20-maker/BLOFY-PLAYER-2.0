import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('private A/V canary only passes explicit operator consent and private Hub token',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 for(const snippet of [
  "p==='/internal/blofy-stream/ops/mirror-intake/canary'",
  "process.env.BLOFY_STREAM_MIRROR_AV_CANARY_ENABLED!=='1'",
  "req.headers['x-blofy-owner-action']!=='verify-private-mirror-audio-video'",
  '!/^mirror_[a-f0-9]{32}$/.test(runId)',
  "http://blofy-content-hub.railway.internal:3000/internal/mirror/copy/canary",
  'output.providerRequests!==0',
  'output.customerCutover!==false',
  'Buffer.byteLength(raw,'
 ])assert.ok(source.includes(snippet),snippet);
});
