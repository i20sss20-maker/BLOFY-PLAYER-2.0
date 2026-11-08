import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyXtreamTransportError,safeXtreamTransportCategory}
 from '../src/xtream-transport-errors.mjs';
import {redactXtreamError} from '../src/xtream-core.mjs';
import {readFile} from 'node:fs/promises';

const nested=code=>new TypeError('fetch failed',{cause:Object.assign(new Error('private upstream address'),{code})});

test('provider network failures receive fixed safe diagnostic identifiers',()=>{
 const cases={
  ENOTFOUND:'xtream_transport_dns_failed',
  EAI_AGAIN:'xtream_transport_dns_failed',
  ECONNREFUSED:'xtream_transport_connection_refused',
  ECONNRESET:'xtream_transport_connection_reset',
  UND_ERR_SOCKET:'xtream_transport_connection_reset',
  ETIMEDOUT:'xtream_transport_timeout',
  UND_ERR_CONNECT_TIMEOUT:'xtream_transport_timeout',
  CERT_HAS_EXPIRED:'xtream_transport_tls_invalid',
  ERR_TLS_CERT_ALTNAME_INVALID:'xtream_transport_tls_invalid'
 };
 for(const [code,expected] of Object.entries(cases)){
  const error=nested(code);
  assert.equal(classifyXtreamTransportError(error),expected,code);
  assert.equal(safeXtreamTransportCategory(error),expected,code);
  assert.equal(redactXtreamError(error),expected,code);
 }
});
test('direct preflight DNS errors use a safe category without revealing a hostname',()=>{
 const error=Object.assign(new Error('getaddrinfo ENOTFOUND private-panel.example'),{code:'ENOTFOUND'});
 assert.equal(safeXtreamTransportCategory(error),'xtream_transport_dns_failed');
 assert.equal(redactXtreamError(error),'xtream_transport_dns_failed');
});
test('application and provider errors keep their category',()=>{
 const error=Object.assign(new Error('xtream_source_busy_retry'),{code:'53300'});
 assert.equal(safeXtreamTransportCategory(error),null);
 assert.equal(redactXtreamError(error),'xtream_source_busy_retry');
});

test('timeouts and unknown fetch failures never leak upstream URLs or credentials',()=>{
 const url='https://host.example:8080/live/privateuser/privatepass/123.ts';
 const failures=[
  Object.assign(new Error('cancel '+url),{name:'AbortError'}),
  new TypeError('fetch failed',{cause:new Error(url)}),
  new TypeError('fetch failed')
 ];
 for(const error of failures){
  const message=redactXtreamError(error);
  assert.match(message,/^xtream_transport_/);
  assert.doesNotMatch(message,/privateuser|privatepass|host\.example|live\//);
 }
});
test('provider permission and catalog HTTP errors remain distinct from network failures',()=>{
 const errors=['xtream_http_401','xtream_http_403','xtream_http_404','xtream_http_456'];
 for(const message of errors){
  const error=new Error(message);
  assert.equal(safeXtreamTransportCategory(error),null);
  assert.equal(redactXtreamError(error),message);
 }
});
test('source admin only categorizes network failures without retrying denied credentials',async()=>{
 const [admin,gateway,ui]=await Promise.all([
  readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
 ]);
 assert.match(admin,/safeXtreamTransportCategory\(error\)/);
 assert.match(admin,/await response\.body\?\.cancel\(\)/);
 assert.ok(admin.includes('if (!response.ok) {'));
 assert.ok(admin.includes('await response.body?.cancel().catch(()=>{});'));
 assert.ok(admin.includes('throw new Error(`xtream_http_${status}`)'));
 assert.match(gateway,/const networkReason=safeXtreamTransportCategory\(error\)/);
 // True network failures still return transient 502/504, unlike
 // an authenticated relay's confirmed terminal provider 404.
 assert.ok(gateway.includes("safeReason==='headers_timeout'||safeReason==='media_read_timeout'?504:502, 'Upstream unavailable'"));
 assert.match(gateway,/return text\(res,clientStatus,/);
 for(const phrase of ['xtream_transport_dns_failed','xtream_transport_connection_reset',
   'xtream_transport_timeout','xtream_transport_tls_invalid','xtream_transport_connection_refused'])
   assert.ok(ui.includes(phrase),phrase);
});

test('premium operations snapshot exposes only allowlisted diagnostic IDs',async()=>{
 const [sourceUi,premium]=await Promise.all([
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
  readFile(new URL('../web/stream-premium.js',import.meta.url),'utf8')
 ]);
 const section=sourceUi.split('const dashboardSnapshot=')[1]?.split('window.__BLOFY_STREAM_SNAPSHOT__')[0]||'';
 assert.match(section,/issueCode/);
 assert.match(section,/\.find\(code=>error\.includes\(code\)\)/);
 assert.doesNotMatch(section,/issueCode:\s*(?:error|item\.lastError)\s*[,}]/);
 assert.match(premium,/SOURCE_ISSUE_LABELS/);
 assert.match(premium,/Object\.hasOwn\(SOURCE_ISSUE_LABELS/);
});
