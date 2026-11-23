import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamMediaReadIdleMs} from '../src/xtream-media-read-deadline.mjs';
test('live stream stall watchdog expires earlier than VOD without affecting startup',()=>{
 assert.equal(xtreamMediaReadIdleMs('live'),30000);
 assert.equal(xtreamMediaReadIdleMs('movie'),45000);
 assert.equal(xtreamMediaReadIdleMs('series'),45000);
 assert.throws(()=>xtreamMediaReadIdleMs('unknown'),/kind_invalid/);
});
test('real customer media relay uses idle watchdog only after validated startup',async()=>{
 const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(source,/const first = await readChunk\(15000\)/);
 const inspection=source.indexOf('if(!inspection.valid)throw new Error(inspection.reason)');
 const idle=source.indexOf('const chunk=await readChunk(xtreamMediaReadIdleMs(kind))');
 assert.ok(inspection>0&&idle>inspection);
 assert.match(source,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PRODUCTION/);
 assert.match(source,/no-store, no-transform/);
});
