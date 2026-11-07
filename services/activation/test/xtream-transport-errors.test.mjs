import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { xtreamTransportReason,redactXtreamError } from '../src/xtream-core.mjs';

test('node fetch failed exposes safe actual connection cause without leaking credentials',()=>{
  const fixtures={
    ENOTFOUND:'xtream_dns_failure',
    EAI_AGAIN:'xtream_dns_failure',
    ECONNREFUSED:'xtream_connection_refused',
    ETIMEDOUT:'xtream_connect_timeout',
    UND_ERR_CONNECT_TIMEOUT:'xtream_connect_timeout',
    EHOSTUNREACH:'xtream_network_unreachable',
    ENETUNREACH:'xtream_network_unreachable',
    ECONNRESET:'xtream_connection_reset',
    EPIPE:'xtream_connection_reset',
    UND_ERR_SOCKET:'xtream_connection_reset',
    CERT_HAS_EXPIRED:'xtream_tls_failure',
    ERR_TLS_CERT_ALTNAME_INVALID:'xtream_tls_failure'
  };
  for(const [code,reason] of Object.entries(fixtures)){
    const e=Object.assign(new TypeError('fetch failed'),{
      cause:Object.assign(new Error('secret username=PRIVATE password=PRIVATE'),{code})
    });
    assert.equal(xtreamTransportReason(e),reason,code);
    const safe=redactXtreamError(e);
    assert.equal(safe,reason);
    assert.doesNotMatch(safe,/PRIVATE|username|password|https?:\/\//);
  }
});

test('aggregate errors are classified without echoing address/credentials',()=>{
  const error=Object.assign(new TypeError('fetch failed'),{
    cause:new AggregateError([
      Object.assign(new Error('172.0.0.1:80?password=SECRET'),{code:'ECONNREFUSED'})
    ],'upstream connect error')
  });
  assert.equal(redactXtreamError(error),'xtream_connection_refused');
  assert.equal(redactXtreamError(new TypeError('fetch failed')),'xtream_transport_failed');
});

test('real provider HTTP status remains exact and never gets misclassified as transport',()=>{
  for(const code of [401,403,404,429,456,503]){
    const e=new Error('xtream_http_'+code);
    assert.equal(xtreamTransportReason(e),null);
    assert.equal(redactXtreamError(e),'xtream_http_'+code);
  }
});

test('both admin screens render classified transport errors and never recommend deleting source',async()=>{
  const [native,js]=await Promise.all([
    readFile(new URL('../src/xtream-native-controls.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
  ]);
  for(const code of ['xtream_dns_failure','xtream_connection_refused',
    'xtream_connect_timeout','xtream_network_unreachable',
    'xtream_connection_reset','xtream_tls_failure','xtream_transport_failed']){
    assert.ok(native.includes(code),'missing native '+code);
    assert.ok(js.includes(code),'missing dynamic '+code);
  }
  assert.match(native,/لا تعيد حذفه/);
  assert.match(js,/لا تحذف المصدر/);
});
