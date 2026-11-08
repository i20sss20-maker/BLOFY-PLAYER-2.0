import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('direct source probe uses the SAME imported movie IDs as isolated probe',async()=>{
 const js=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const fn=js.indexOf("async function probeXtreamPlayback(id,mediaType='live',{forcePortalDirect=false}={})");
 assert.ok(fn>0);
 const s=js.slice(fn,js.indexOf('async function fetchAccount(',fn));
 assert.match(s,/ORDER BY name ASC LIMIT 4/);
 assert.match(s,/!forcePortalDirect&&\(shouldUseIndependentSourceMedia/);
 assert.match(s,/shouldRetryXtreamWithoutRange/);
 const a=js.indexOf("if(process.env.BLOFY_XTREAM_DIRECT_MEDIA_PROBE_ON_BOOT==='1')");
 const b=js.indexOf('// Full local audit scans every imported item',a);
 const hook=js.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(hook,/BLOFY_XTREAM_EGRESS_SOURCE_ID/);
 assert.match(hook,/probeXtreamPlayback\(id,'movie',\{forcePortalDirect:true\}\)/);
 assert.match(hook,/catalogMutation:false,customerCutover:false/);
 assert.doesNotMatch(hook,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});
test('operator result is status-only: no source names or media URLs',async()=>{
 const js=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=js.indexOf("if(process.env.BLOFY_XTREAM_DIRECT_MEDIA_PROBE_ON_BOOT==='1')");
 const b=js.indexOf('// Full local audit scans every imported item',a);
 const hook=js.slice(a,b);
 assert.doesNotMatch(hook,/title:row.title|row.name|row.source_id|sourceUrl/);
 assert.match(hook,/httpStatus/);
 assert.match(hook,/rangeFallbackUsed/);
});
