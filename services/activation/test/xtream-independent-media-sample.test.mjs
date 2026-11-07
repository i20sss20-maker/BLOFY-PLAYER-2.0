import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('independent media sample is opt-in, bounded, confidential and does not change live client route',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=code.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROBE_ON_BOOT==='1')");
 const end=code.indexOf("async function cancelSourceSync(",start);
 assert.ok(start>0&&end>start);
 const probe=code.slice(start,end);
 assert.match(probe,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(probe,/ORDER BY random\(\) LIMIT 3/);
 assert.match(probe,/upstreamStatuses:checks\.map/);
 assert.match(probe,/denialCodes:checks\.map/);
 assert.match(probe,/issueStreamRelayGrant\(\{sourceUrl:sourceUrl\.href,kind:'live'\}\)/);
 assert.match(probe,/audioVideoDecoded:false/);
 assert.match(probe,/customerCutover:false/);
 assert.match(probe,/credentialsLogged:false/);
 assert.doesNotMatch(probe,/UPDATE|DELETE|INSERT|res\.writeHead/);
});
