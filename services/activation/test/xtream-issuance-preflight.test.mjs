import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  summarizeIssuancePreflight,
  issuanceErrorReason,
  shouldRetryIssuanceMedia,
  shouldRetryXtreamAccountPreflight,
  MAX_ISSUANCE_SOURCES,
  PREFLIGHT_TTL_MS
} from '../src/xtream-issuance-preflight.mjs';

const source={sourceId:'test',checks:[
  {kind:'account',ok:true},
  {kind:'live',ok:true},
  {kind:'movie',ok:true},
  {kind:'series',ok:true}
]};

test('only all-sample-success may authorize issuing subscriber accounts',()=>{
  assert.equal(summarizeIssuancePreflight([source]).ready,true);
  assert.equal(summarizeIssuancePreflight([source]).mediaSampleCount,3);
  assert.equal(summarizeIssuancePreflight([]).ready,false);
  assert.equal(summarizeIssuancePreflight([{checks:[{kind:'account',ok:true}]}]).ready,false);
  assert.equal(summarizeIssuancePreflight([{checks:[{kind:'live',ok:true}]}]).ready,true);
  assert.equal(summarizeIssuancePreflight([source,{checks:[]}]).ready,false);
  for(const reason of ['upstream_http_404','source_auth_denied','timeout','series_has_no_episodes']){
    const failed={sourceId:'blocked',checks:[{kind:'movie',ok:false,reason}]};
    const report=summarizeIssuancePreflight([source,failed]);
    assert.equal(report.ready,false,reason);
    assert.equal(report.failed,1);
  }
});

test('preflight errors are scoped, bounded and sanitized without leaking credentials',()=>{
  assert.ok(MAX_ISSUANCE_SOURCES<=10);
  assert.ok(PREFLIGHT_TTL_MS>0&&PREFLIGHT_TTL_MS<=120_000);
  assert.equal(issuanceErrorReason('xtream_gateway_upstream_403'),'upstream_403');
  assert.equal(issuanceErrorReason('xtream_gateway_upstream_json_invalid'),'source_api_unavailable');
  assert.equal(issuanceErrorReason('upstream password=secrets'),'source_unreachable');
  assert.equal(issuanceErrorReason('xtream_secret_decryption_failed'),'source_credentials_unreadable');
});

test('both account issuance routes require server-side successful playback preflight before any insert',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const single=src.slice(src.indexOf('async function createAccount('),src.indexOf('async function createAccountsBulk('));
  const bulk=src.slice(src.indexOf('async function createAccountsBulk('),src.indexOf('async function patchAccount('));
  for(const code of [single,bulk]){
    assert.match(code,/const sourceId=await checkedAccountSourceId\(body.sourceId\)/);
    assert.match(code,/await assertIssuanceReady\(sourceId\)/);
    assert.ok(code.indexOf('await assertIssuanceReady(sourceId)')<code.indexOf('INSERT INTO blofy_xtream_gateway_accounts'));
  }
  const preview=src.indexOf("url.pathname === '/api/v1/admin/xtream-gateway/issuance-preflight'");
  const boundary=src.indexOf("if (!requireAdmin(req, res)) return;");
  const create=src.indexOf("url.pathname === '/api/v1/admin/xtream-gateway/accounts'");
  assert.ok(preview>boundary&&create>preview);
  assert.match(src,/const rows=\(await pool.query/);
  assert.match(src,/WHERE enabled=TRUE AND publish_catalog=TRUE AND deletion_requested_at IS NULL/);
  assert.match(src,/sanitizeXtreamAccount\(account\).authenticated/);
  assert.match(src,/xtreamEpisodePlaybackCandidates\(payload,2\)/);
  assert.match(src,/inspectXtreamMediaChunk\(Buffer.concat\(samples,total\)/);
  assert.match(src,/issuancePreflightRunning/);
  assert.match(src,/issuancePreflightCache/);
  assert.match(src,/checkedFetch\(url,\{method:'GET',headers,signal\}\)/);
  assert.match(src,/const ok=evidence.valid && evidence.format!=='unknown'/);
});

test('admin user issuance cannot skip a failed test with an offline confirmation',async()=>{
  const [html,js]=await Promise.all([
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/xtream-gateway-admin.js',import.meta.url),'utf8')
  ]);
  for(const id of ['gatewayPreflightRun','gatewayPreflightStatus','gatewayPreflightDetails'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/id="gatewayCreateBtn"[^>]+disabled/);
  assert.match(js,/gatewayPreflightReady\(\)/);
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/issuance-preflight/);
  assert.match(js,/gx\('gatewaySourceId'\)\?\.addEventListener\('change',clearGatewayPreflight\)/);
  assert.doesNotMatch(js,/المصدر المختار غير متصل حاليًا.*window\.confirm/);
  assert.match(js,/if\(!gatewayPreflightReady\(\)\)/);
  assert.match(html,/xtream-gateway-admin\.js\?v=20261107-bounded-samples-v7/);
});

test('preflight selects the source server ID used as encryption associated data',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const preflight=src.slice(src.indexOf('async function runIssuancePreflight('),src.indexOf('async function issuancePreflight('));
  // Production uses per-server AES-GCM associated data: username:<server_id>.
  // Without the alias both independent sources fail before any network call.
  assert.match(preflight,/SELECT id,id AS server_id,name,base_url,username_secret,password_secret/);
  const {encryptXtreamSecret,decryptXtreamSecret}=await import('../src/xtream-core.mjs');
  const sourceId='11111111-1111-4111-8111-111111111111';
  const key='cd'.repeat(32);
  const encrypted=encryptXtreamSecret('fixture-media-user',key,'username:'+sourceId);
  const dbRow={id:sourceId,server_id:sourceId,username_secret:encrypted};
  assert.equal(decryptXtreamSecret(dbRow.username_secret,key,'username:'+dbRow.server_id),'fixture-media-user');
  assert.throws(()=>decryptXtreamSecret(encrypted,key,'username:undefined'),/xtream_secret_decryption_failed/);
});

test('temporary network errors retry once; provider 404, 403 and 456 never retry',()=>{
  for(const reason of ['timeout','source_unreachable','upstream_http_5xx'])
    assert.equal(shouldRetryIssuanceMedia({reason},8000),true,reason);
  for(const httpStatus of [408,500,502,503,504])
    assert.equal(shouldRetryIssuanceMedia({httpStatus},8000),true,String(httpStatus));
  for(const [reason,httpStatus] of [
    ['upstream_http_404',404],['upstream_http_403',403],
    ['upstream_http_456',456],['source_auth_denied',401],
    ['media_unverified',200]
  ])assert.equal(shouldRetryIssuanceMedia({reason,httpStatus},8000),false,reason);
  assert.equal(shouldRetryIssuanceMedia({reason:'timeout'},3300),false);
});

test('source auth retries only transport and 5xx while keeping 404/456 and rate limit strict',()=>{
  const transient=['fetch failed','xtream_gateway_upstream_408',
    'xtream_gateway_upstream_500','xtream_gateway_upstream_502',
    'xtream_gateway_upstream_503','xtream_gateway_upstream_504'];
  for(const message of transient)
    assert.equal(shouldRetryXtreamAccountPreflight(new Error(message),12000),
      true,message);
  for(const error of [
    Object.assign(new Error('timed out'),{name:'TimeoutError'}),
    Object.assign(new Error('aborted'),{name:'AbortError'})
  ])assert.equal(shouldRetryXtreamAccountPreflight(error,12000),true);
  for(const message of ['xtream_gateway_upstream_401',
    'xtream_gateway_upstream_403','xtream_gateway_upstream_404',
    'xtream_gateway_upstream_429','xtream_gateway_upstream_456',
    'xtream_gateway_upstream_json_invalid','xtream_private_host_blocked',
    'xtream_secret_decryption_failed'])
    assert.equal(shouldRetryXtreamAccountPreflight(new Error(message),12000),
      false,message);
  assert.equal(shouldRetryXtreamAccountPreflight(new Error('fetch failed'),2500),
    false,'Never extend the overall issuance deadline for retries');
});
