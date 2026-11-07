import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('one-shot isolated live sync is strictly off by default and never expands into VOD/series',async()=>{
 const code=await fs.readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=code.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_LIVE_SYNC_ON_BOOT==='1')");
 const nextProbe=code.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROBE_ON_BOOT==='1')",start);
 const stop=nextProbe>start?nextProbe:code.indexOf("async function cancelSourceSync(",start);
 assert.ok(start>0&&stop>start);
 const block=code.slice(start,stop);
 assert.match(block,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(block,/validUuid\(id\)/);
 assert.match(block,/syncServer\(id,\['live'\]\)/);
 assert.doesNotMatch(block,/\['live','movie','series'\]/);
 assert.match(block,/customerCutover:false/);
 assert.doesNotMatch(block,/password|creds|username/);
});
