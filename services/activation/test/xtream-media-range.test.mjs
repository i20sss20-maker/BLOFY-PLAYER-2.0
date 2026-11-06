import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {firstByteXtreamRange,shouldRetryXtreamWithoutRange} from '../src/xtream-media-range.mjs';

test('only missing start-of-file ranges get one plain-GET retry',()=>{
  assert.equal(firstByteXtreamRange('bytes=0-1023'),true);
  assert.equal(firstByteXtreamRange('bytes=0-'),true);
  assert.equal(firstByteXtreamRange(' bytes=0-2047 '),true);
  for(const value of ['bytes=1-','bytes=1024-2048','bytes=-100','bytes=0-100,200-300','bytes=0-abc','','bytes=0-9999999999999']){
    assert.equal(firstByteXtreamRange(value),false,value);
  }
  for(const status of [404,416])
    assert.equal(shouldRetryXtreamWithoutRange({status,range:'bytes=0-1023'}),true);
  for(const status of [200,206,301,401,403,429,500,502,503,504])
    assert.equal(shouldRetryXtreamWithoutRange({status,range:'bytes=0-1023'}),false,String(status));
  assert.equal(shouldRetryXtreamWithoutRange({status:404,range:'bytes=0-1023',alreadyRetried:true}),false);
  assert.equal(shouldRetryXtreamWithoutRange({status:404,range:'bytes=0-1023',method:'HEAD'}),false);
  assert.equal(shouldRetryXtreamWithoutRange({status:404,range:'bytes=500-'}),false);
});

test('main gateway only drops initial 0-byte Range after a 404/416, keeps stable 403 and seeks',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const a=source.indexOf('async function proxyMedia(');
  const b=source.indexOf('async function probeGatewayMedia(',a);
  const media=source.slice(a,b);
  assert.match(media,/firstByteXtreamRange\(headers\.range\)/);
  assert.match(media,/shouldRetryXtreamWithoutRange\(/);
  assert.match(media,/delete headers\.range/);
  assert.match(media,/maxAttempts = req\.method === 'HEAD' \? 1 : initialRange \? 3 : 2/);
  assert.match(media,/\[408,500,502,503,504\]/);
  assert.match(media,/!transientRetried/);
  assert.match(media,/transientRetried=true/);
  assert.match(media,/return text\(res, 502, 'Upstream unavailable'\)/);
});

test('source-native and episode probes also retry 404/416 as GET without range',async()=>{
  const [admin,ui,helper]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../src/xtream-series-probe.mjs',import.meta.url),'utf8')
  ]);
  const start=admin.indexOf('async function probeXtreamEpisodeMedia(');
  const end=admin.indexOf('async function fetchAccount(',start);
  const checks=admin.slice(start,end);
  assert.match(checks,/shouldRetryXtreamWithoutRange/);
  assert.ok(checks.split('shouldRetryXtreamWithoutRange(').length>=3);
  assert.match(checks,/rangeFallbackUsed:!useFirstByteRange/);
  assert.match(checks,/rangeFallbackUsed:mediaType==='movie'&&!useFirstByteRange/);
  assert.match(ui,/check\.rangeFallbackUsed/);
  assert.match(helper,/pass\?\.rangeFallbackUsed/);
  assert.doesNotMatch(checks,/while\(true\)\s*await fetch/);
});
