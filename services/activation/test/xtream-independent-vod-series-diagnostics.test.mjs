import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('one-shot admin checks do not change customer playback or other sources',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROBE_ON_BOOT==='1')");
 const b=c.indexOf('async function cancelSourceSync(',a);
 assert.ok(a>0&&b>a);
 const x=c.slice(a,b);
 assert.match(x,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(x,/for\(const mediaType of \['movie','series','episode'\]\)/);
 assert.match(x,/probeXtreamPlayback\(id,mediaType\)/);
 assert.match(x,/customerCutover:false/);
 assert.match(x,/credentialsLogged:false/);
 assert.doesNotMatch(x,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});
test('series info and episode sample use selected source independent egress',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function probeXtreamEpisodeMedia('),b=c.indexOf('async function probeXtreamSeries(',a);
 const e=c.slice(a,b);
 assert.match(e,/shouldUseIndependentSourceMedia\\(\\{/);
 assert.match(e,/sourceId:source.id,kind:'series',extension:episode.extension/);
 assert.match(e,/issueStreamRelayGrant\(/);
 assert.match(e,/sourceUrl:target.href,kind:'series'/);
 const s=c.slice(b,c.indexOf('async function persistSourceMediaProbe(',b));
 assert.match(s,/timeoutMs:9500,sourceId:source\.id/);
});
test('movie check requires same catalog allowlist and never changes player route',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function probeXtreamPlayback('),b=c.indexOf('async function fetchAccount(',a);
 const p=c.slice(a,b);
 assert.match(p,/shouldUseIndependentSourceMedia\\(\\{/);
 assert.match(p,/issueStreamRelayGrant\(/);
});