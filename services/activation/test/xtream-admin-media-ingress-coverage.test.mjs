import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
test('operator media probes register ingress before grants and fetches',()=>{
 for(const [start,end] of [
 ['async function probeXtreamEpisodeMedia','async function probeXtreamSeries'],
 ['async function probeXtreamPlayback','async function fetchAccount'],
 ["if(process.env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROBE_ON_BOOT==='1')",'// Operator-only']
 ]){
  const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,start);
  const s=src.slice(a,b);
  assert.ok(s.indexOf('await enterAdminMediaIngress(')>=0,start);
  assert.ok(s.indexOf('await enterAdminMediaIngress(')<s.indexOf('await issueStreamRelayGrant('),start);
  assert.match(s,/if\(!hold\.ok\)return/);
  assert.match(s,/finally\{await hold\.close\(\)\}/);
 }
});
