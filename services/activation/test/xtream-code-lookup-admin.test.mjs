import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStreamDurationCodes,streamCodeProof} from '../src/xtream-duration-codes.mjs';

const keyHex='e'.repeat(64);
const code='24681357'; // synthetic test voucher, not a customer code
const voucherId='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const accountId='d2bb0397-1c56-4751-adc9-1a17758022f6';
const now=Date.parse('2026-11-12T01:00:00Z');
const base={
  id:voucherId,code_hash:streamCodeProof(code,keyHex),
  code_hint:'24••••57',code_channel:'app',duration_days:30,
  max_connections:1,account_id:accountId,redeemed_at:new Date(now-15*86400000),
  expires_at:new Date(now+15*86400000),revoked_at:null,
  code_vault:'hidden-private-code',label:'BLOFY STREAM',transfer_count:0,
  extended_days:0,linked_account_enabled:true,linked_account_exists:true,
  linked_account_expires_at:new Date(now+15*86400000)
};
function fixture(change={}){
  const queries=[];
  const row={...base,...change};
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    assert.match(sql,/WHERE c\.code_hash=\$1 LIMIT 1/);
    return {rows:params[0]===row.code_hash?[row]:[]};
  }};
  const service=createStreamDurationCodes({pool,keyHex,clock:()=>now});
  return {service,queries};
}
test('read-only admin lookup finds a redeemed code using its HMAC proof, without replay',async()=>{
  const d=fixture();
  const result=await d.service.lookup(code);
  assert.equal(result.ok,true);
  assert.equal(result.item.status,'redeemed');
  assert.equal(result.item.codeHint,'24••••57');
  assert.equal(result.subscription.active,true);
  assert.equal(result.subscription.canExtend,true);
  assert.equal(result.subscription.requiresDeviceApproval,true);
  assert.equal(d.queries.length,1);
  assert.deepEqual(d.queries[0].params,[streamCodeProof(code,keyHex)]);
  assert.match(d.queries[0].sql,/^SELECT c\.\*/);
  assert.doesNotMatch(JSON.stringify(result),/hidden-private-code|code_hash|redeemed_device_hash|password|24681357/);
});
test('missing/invalid codes do not mint accounts or reveal subscriber details',async()=>{
  const d=fixture();
  assert.equal((await d.service.lookup('12345678')).code,'stream_code_not_found');
  await assert.rejects(d.service.lookup('123'),/stream_code_invalid/);
  assert.equal(d.queries.length,1);
});
test('expired voucher is renewable but not automatically reusable',async()=>{
  const d=fixture({
    expires_at:new Date(now-86400000),
    linked_account_expires_at:new Date(now-86400000)
  });
  const r=await d.service.lookup(code);
  assert.equal(r.subscription.expired,true);
  assert.equal(r.subscription.active,false);
  assert.equal(r.subscription.canExtend,true);
  assert.equal(r.item.status,'redeemed');
});
test('disabled or missing account is not silently re-enabled by lookup',async()=>{
  const disabled=await fixture({linked_account_enabled:false}).service.lookup(code);
  assert.equal(disabled.subscription.active,false);
  assert.equal(disabled.subscription.accountEnabled,false);
  assert.equal(disabled.subscription.canExtend,true);
  const missing=await fixture({linked_account_exists:false,linked_account_enabled:null,linked_account_expires_at:null})
    .service.lookup(code);
  assert.equal(missing.subscription.accountExists,false);
  assert.equal(missing.subscription.canExtend,false);
  assert.equal(missing.subscription.active,false);
});
test('unredeemed voucher remains unused and must not be extended or rebound',async()=>{
  const d=fixture({redeemed_at:null,account_id:null,expires_at:null,
    linked_account_exists:false,linked_account_enabled:null,linked_account_expires_at:null});
  const r=await d.service.lookup(code);
  assert.equal(r.item.status,'unused');
  assert.equal(r.subscription.redeemed,false);
  assert.equal(r.subscription.canExtend,false);
});
test('server route is admin-gated and code input travels only in POST body',async()=>{
  const hook=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const route=hook.indexOf("url.pathname==='/api/v1/admin/xtream-gateway/codes/lookup'");
  assert.ok(route>0);
  const guard=hook.lastIndexOf('if (!requireAdmin(req, res)) return;',route);
  assert.ok(guard>0&&guard<route);
  assert.match(hook.slice(route-80,route+380),/streamCodes\.lookup\(payload\.code\)/);
  const script=await readFile(new URL('../web/xtream-gateway-admin.js',import.meta.url),'utf8');
  const panel=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');
  assert.match(script,/method:'POST',cache:'no-store',body:JSON\.stringify\(\{code\}\)/);
  assert.match(script,/codes\/'\+encodeURIComponent\(record\.item\.id\)\+'\/extend'/);
  assert.match(script,/appCode\\?'\\/transfer':'\\/recover-xtream'/);
  assert.match(panel,/id="stream-code-management"/);
  assert.match(panel,/id="streamCodeRenewButton"/);
});
