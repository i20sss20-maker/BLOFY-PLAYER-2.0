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
 assert.match(e,/shouldUseIndependentXtreamSource\(source\.id\)/);
 assert.match(e,/issueStreamRelayGrant\(/);
 assert.match(e,/sourceUrl:target.href,kind:'series'/);
 const s=c.slice(b,c.indexOf('async function persistSourceMediaProbe(',b));
 assert.match(s,/timeoutMs:9500,sourceId:source\.id/);
});
test('movie check requires same catalog allowlist and never changes player route',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function probeXtreamPlayback('),b=c.indexOf('async function fetchAccount(',a);
 const p=c.slice(a,b);
 assert.match(p,/mediaType==='movie'&&shouldUseIndependentXtreamSource\(source\.id\)/);
 assert.match(p,/issueStreamRelayGrant\(/);
});
test('boot VOD proof never calls mixed successes all healthy or hides failed fourth sample',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROBE_ON_BOOT==='1')");
 const b=c.indexOf('async function cancelSourceSync(',a);
 const s=c.slice(a,b);
 assert.match(s,/const good=samples.filter\(x=>x\?\.ok\)\.length/);
 assert.match(s,/const bad=samples.filter\(x=>x&&!x.ok\)\.length/);
 assert.match(s,/ok:good>0&&bad===0,partial:good>0&&bad>0/);
 assert.match(s,/cleanSamples:good,failedSamples:bad/);
 assert.match(s,/upstreamMissingSamples:upstreamMissing/);
 assert.match(s,/x\?\.error==='relay_provider_not_found'/);
 assert.match(s,/statuses:samples.map/);
 assert.match(s,/reasons:samples.map/);
 assert.doesNotMatch(s,/report\.checks\?\.slice\(0,3\)/);
 assert.doesNotMatch(s,/credentials:\s*creds|base_url|username_secret|password_secret/);
});

test('boot VOD proof records only boolean evidence for direct source, never URL',async()=>{
 const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=admin.indexOf("if(process.env.BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROBE_ON_BOOT==='1')");
 const b=admin.indexOf('async function cancelSourceSync(',a);
 const block=admin.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(block,/failedWithAdvertisedDirectSource:/);
 assert.match(block,/x.directSourceAdvertised===true/);
 assert.match(admin,/metadata->>'directSourcePresent' AS advertised_direct_source/);
 assert.match(admin,/directSourceAdvertised:episode.directSourceAdvertised===true/);
 assert.doesNotMatch(block,/direct_source\s*:\s*row|sourceUrl|source\.base_url/);
});
