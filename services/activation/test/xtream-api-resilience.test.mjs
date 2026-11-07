import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {retryableXtreamAccountError,withXtreamAccountReconnect} from '../src/xtream-api-resilience.mjs';

test('idempotent account metadata reconnects exactly once after a temporary reset',async()=>{
  let calls=0;const delays=[];
  const value=await withXtreamAccountReconnect(async()=>{
    calls++;
    if(calls===1)throw new Error('xtream_transport_connection_reset');
    return {authenticated:true};
  },{wait:async ms=>delays.push(ms)});
  assert.deepEqual(value,{authenticated:true});
  assert.equal(calls,2);
  assert.deepEqual(delays,[450]);
});
test('failed second attempt stops without a retry storm',async()=>{
  let calls=0;const original=new Error('xtream_transport_timeout');
  await assert.rejects(withXtreamAccountReconnect(async()=>{
    calls++;throw original;
  },{wait:async()=>{}}),error=>error===original);
  assert.equal(calls,2);
});
test('provider denials and nontransient errors are never retried',async()=>{
  const forbidden=[
    'xtream_http_401','xtream_http_403','xtream_http_404','xtream_http_429',
    'xtream_http_456','xtream_auth_failed','xtream_private_host_blocked',
    'xtream_transport_tls_invalid','xtream_transport_connection_refused'
  ];
  for(const code of forbidden){
    let calls=0;await assert.rejects(withXtreamAccountReconnect(async()=>{
      calls++;throw new Error(code);
    },{wait:async()=>{}}),new RegExp(code));
    assert.equal(calls,1,code);
    assert.equal(retryableXtreamAccountError(code),false);
  }
});
test('only network transients and 502/503/504 are retryable',()=>{
  for(const code of ['xtream_transport_connection_reset','xtream_transport_timeout',
    'xtream_transport_dns_failed','xtream_transport_unreachable',
    'xtream_http_502','xtream_http_503','xtream_http_504'])
    assert.equal(retryableXtreamAccountError(code),true,code);
  assert.equal(retryableXtreamAccountError('xtream_http_400'),false);
  assert.equal(retryableXtreamAccountError(''),false);
});
test('configuration and attempt budget are bounded',async()=>{
  for(const count of [0,-1,3,99])await assert.rejects(
    withXtreamAccountReconnect(async()=>true,{maxAttempts:count}),
    /xtream_account_retry_configuration_invalid/
  );
});
test('production only retries account metadata and releases rejected HTTP response bodies',async()=>{
  const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function checkedFetch(');
  const end=source.indexOf('// Real series diagnostics',start);
  const checked=source.slice(start,end);
  assert.match(checked,/await response\.body\?\.cancel\(\)\.catch\(\(\)=>\{\}\);[\s\S]*throw new Error\(`xtream_http_\$\{status\}\`\)/);
  const account=source.slice(source.indexOf('async function fetchAccount('),source.indexOf('async function testServer('));
  assert.match(account,/withXtreamAccountReconnect/);
  const sync=source.slice(source.indexOf('async function syncItems('),source.indexOf('async function finalizeTypeSync('));
  assert.doesNotMatch(sync,/withXtreamAccountReconnect/);
  const media=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(media,/withXtreamAccountReconnect/);
});
test('media samples identify network causes; issue-scoped operator batch respects selected filter',async()=>{
  const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  assert.ok((admin.match(/safeXtreamTransportCategory\(error\)\|\|'upstream_unreachable'/g)||[]).length>=2);
  const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(ui,/filter!=='issues'\|\|Boolean\(row\.lastError\|\|row\.status==='offline'\|\|row\.status==='error'\)/);
  assert.match(ui,/xtream_transport_connection_reset:'المصدر قطع الاتصال/);
});
