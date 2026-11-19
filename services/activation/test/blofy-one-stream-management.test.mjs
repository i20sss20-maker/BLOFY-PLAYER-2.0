import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read = path => readFile(new URL('../'+path,import.meta.url),'utf8');

test('BLOFY ONE serves real STREAM/Xtream management inline instead of only linking away',async()=>{
  const [html,js,css,hook]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-stream.js'),
    read('web/blofy-one-stream.css'),read('src/admin-console-hook.mjs')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  assert.ok(html.includes('/blofy-one-stream.js?v=20261118-v1'));
  assert.ok(html.includes('/blofy-one-stream.css?v=20261118-v1'));
  const ids=[
    'stream-management','one-stream-refresh','one-stream-accounts-rows','one-stream-codes-rows',
    'one-stream-account-search','one-stream-account-filter','one-stream-code-search',
    'one-stream-code-filter','one-stream-codes-next','one-stream-codes-prev',
    'one-stream-accounts-total','one-stream-active-accounts','one-stream-code-total',
    'one-stream-redeemed','one-stream-unused','one-stream-expiring','one-stream-sold',
    'one-stream-transfers','one-stream-revenue','one-stream-secret',
    'one-stream-secret-code','one-stream-secret-copy','one-stream-secret-xtream',
    'one-stream-secret-hide'
  ];
  for(const id of ids)assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/href="#stream-management"/);
  assert.match(html,/href="#legacy-xtream"/);
  assert.match(css,/@media\(max-width:700px\)/);
  for(const path of ['/blofy-one-stream.js','/blofy-one-stream.css'])
    assert.ok(hook.includes("['"+path+"'"),path);
  assert.match(hook,/x-content-type-options': 'nosniff'/);
});
test('integrated Xtream accounts, vouchers and STREAM sales use authenticated real API routes',async()=>{
  const js=await read('web/blofy-one-stream.js');
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway'\)/);
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/codes\?limit=/);
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/codes\/sales-summary/);
  assert.match(js,/link\/xtream-to-code/);
  assert.match(js,/\/reveal'/);
  assert.match(js,/method,credentials:'same-origin',cache:'no-store'/);
  assert.match(js,/window\.confirm\(/);
  assert.match(js,/result\.subscriptionUnchanged!==true/);
  assert.match(js,/window\.addEventListener\('pagehide',clearSecret\)/);
  assert.match(js,/\$\('one-stream-secret-hide'\)\.addEventListener\('click',clearSecret\)/);
  assert.match(js,/codeOffset=nextOffset/);
  assert.match(js,/form\.requestSubmit\(\)/);
  // No mass credential exports or direct app redemption from admin.
  assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log|eval\(|\.innerHTML\s*=/);
  assert.doesNotMatch(js,/\/api\/v1\/stream\/redeem|rotate-credentials|reset-password/);
  assert.doesNotMatch(js,/\b(password|credential_vault|password_proof)\b/);
});
