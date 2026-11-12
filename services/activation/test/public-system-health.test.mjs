import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicSystemHealth } from '../src/public-system-health.mjs';

test('public status polls only two fixed owned health URLs and sanitizes results',async()=>{
  const seen=[];
  const monitor=createPublicSystemHealth({
    fetchImpl:async (url,opts)=>{
      seen.push({url,opts});
      return {status:200,json:async()=>({ok:true,subscriberPassword:'DO-NOT-SHOW',catalog:[1,2,3]})};
    }
  });
  const result=await monitor.snapshot();
  assert.equal(result.services.downloads.status,'healthy');
  assert.equal(result.services.stream.status,'healthy');
  assert.equal(seen.length,2);
  assert.ok(seen.every(x=>x.url.endsWith('/health')&&x.url.startsWith('https://')));
  assert.ok(seen.every(x=>x.opts.redirect==='manual'&&x.opts.method==='GET'));
  const serialized=JSON.stringify(result);
  assert.ok(!serialized.includes('subscriberPassword'));
  assert.ok(!serialized.includes('DO-NOT-SHOW'));
  assert.ok(!serialized.includes('railway.app'));
  assert.ok(!serialized.includes('blofyplayer.com'));
  assert.match(result.scope,/not verified/);
});

test('HTTP 503 and provider redirects cannot be represented as healthy',async()=>{
  const monitor=createPublicSystemHealth({
    fetchImpl:async url=>({status:url.includes('updates.')?503:302,json:async()=>({ok:true})})
  });
  const report=await monitor.snapshot();
  assert.equal(report.services.downloads.status,'degraded');
  assert.equal(report.services.stream.status,'degraded');
  assert.equal(report.ok,true,'report availability is separate from system health');
});

test('network failure produces unknown, not false all-green',async()=>{
  const monitor=createPublicSystemHealth({
    fetchImpl:async()=>{throw new Error('credential=private')}
  });
  const report=await monitor.snapshot();
  assert.equal(report.services.stream.status,'unknown');
  assert.equal(report.services.downloads.status,'unknown');
  assert.ok(!JSON.stringify(report).includes('private'));
});

test('coalesces concurrent checks, uses bounded cache and refreshes on expiry',async()=>{
  let now=10_000,calls=0;
  const monitor=createPublicSystemHealth({
    clock:()=>now,ttlMs:30000,
    fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,10));
      return {status:200,json:async()=>({ok:true})};
    }
  });
  const reports=await Promise.all(Array.from({length:40},()=>monitor.snapshot()));
  assert.equal(calls,2,'many clients share only two external HTTP probes');
  assert.ok(reports.every(r=>r===reports[0]));
  await monitor.snapshot();assert.equal(calls,2);
  now+=30001;
  await monitor.snapshot();assert.equal(calls,4);
});

test('rejects unsafe expensive configurations before starting probes',()=>{
  assert.throws(()=>createPublicSystemHealth({ttlMs:0}),/system_health_config_invalid/);
  assert.throws(()=>createPublicSystemHealth({timeoutMs:60000}),/system_health_config_invalid/);
});
