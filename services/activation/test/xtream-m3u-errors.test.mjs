import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {safeXtreamM3uFailure} from '../src/xtream-m3u-errors.mjs';

test('M3U test/index exposes safe real network code, never playlist credentials',()=>{
  const lookup={
    ENOTFOUND:'xtream_m3u_dns_failure',
    EAI_AGAIN:'xtream_m3u_dns_failure',
    ECONNREFUSED:'xtream_m3u_connection_refused',
    ETIMEDOUT:'xtream_m3u_connect_timeout',
    UND_ERR_CONNECT_TIMEOUT:'xtream_m3u_connect_timeout',
    ENETUNREACH:'xtream_m3u_network_unreachable',
    EHOSTUNREACH:'xtream_m3u_network_unreachable',
    ECONNRESET:'xtream_m3u_connection_reset',
    EPIPE:'xtream_m3u_connection_reset',
    CERT_HAS_EXPIRED:'xtream_m3u_tls_failure'
  };
  for(const [code,reason]of Object.entries(lookup)){
    const error=Object.assign(new TypeError('fetch failed'),{
      cause:Object.assign(new Error('http://provider.invalid/get.php?username=PRIVATE&password=PRIVATE'),{code})
    });
    assert.equal(safeXtreamM3uFailure(error),reason);
    assert.doesNotMatch(safeXtreamM3uFailure(error),/PRIVATE|password|username|https?:/);
  }
  assert.equal(safeXtreamM3uFailure(new TypeError('fetch failed')),
    'xtream_m3u_connection_failed');
});

test('M3U HTTP statuses remain exact and no raw HTTP response leaks',()=>{
  for(const code of [401,403,404,429,456,502]){
    const value='xtream_m3u_http_'+code;
    assert.equal(safeXtreamM3uFailure(new Error(value)),value);
  }
  assert.equal(safeXtreamM3uFailure(new Error('invalid_header')),
    'xtream_m3u_index_unavailable');
  assert.equal(safeXtreamM3uFailure(new Error('xtream_m3u_invalid_header')),
    'xtream_m3u_invalid_header');
});

test('real M3U test uses ordinary streaming GET without Range to dynamic get.php',async()=>{
  const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function checkSourceM3u(');
  const b=src.indexOf('// Build the full authorized M3U media index',a);
  assert.ok(a>0&&b>a);
  const fn=src.slice(a,b);
  assert.match(fn,/method:'GET',redirect:'manual',signal/);
  assert.doesNotMatch(fn,/range:'bytes=/i);
  assert.match(fn,/isM3uPlaylistPrefix\(bytes\)/);
  assert.match(fn,/safeXtreamM3uFailure\(error\)/);
});

test('index stores safe error code for the operator and does not overwrite already published generation',async()=>{
  const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const a=admin.indexOf('async function runHybridM3uIndex(');
  const b=admin.indexOf('function startHybridM3uIndex(',a);
  assert.ok(a>0&&b>a);
  const fn=admin.slice(a,b);
  assert.match(fn,/const reason=safeXtreamM3uFailure\(error\)/);
  assert.match(fn,/m3u_index_state=\$2::jsonb/);
  assert.match(fn,/m3u_index_generation=\$2::uuid/);
  assert.match(fn,/WHERE id=\$1 AND m3u_url_secret=\$3/);
});

test('both admin screens show safe helpful M3U failure text',async()=>{
  const [native,js]=await Promise.all([
    readFile(new URL('../src/xtream-native-controls.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
  ]);
  for(const reason of ['xtream_m3u_connection_refused',
    'xtream_m3u_connect_timeout','xtream_m3u_connection_reset',
    'xtream_m3u_connection_failed','xtream_m3u_http_403']){
    assert.ok(native.includes(reason));
    assert.ok(js.includes(reason));
  }
  assert.match(native,/m3uIndexError/);
  assert.match(js,/m3u-index-error/);
});
