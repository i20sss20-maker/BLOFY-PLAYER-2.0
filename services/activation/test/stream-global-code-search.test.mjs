import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {createStreamDurationCodes,streamCodeProof}
  from '../src/xtream-duration-codes.mjs';
const key='be'.repeat(32),oldCode='ABCDEF123456ABCDEF123456';
const id='49e7e9e5-4c18-4caa-a14e-e51ab39d8ba9';
const sample={
  id,label:'عميل تجريبي',code_hash:streamCodeProof(oldCode,key),
  code_hint:'AB••••56',code_channel:'xtream',
  duration_days:365,max_connections:1,buyer_name:'خالد',
  buyer_phone:'0551234567',redeemed_at:null,revoked_at:null,
  created_at:new Date('2026-11-18T12:00:00Z'),
  account_id:null,expires_at:null,code_vault:'private-vault-must-not-leak'
};
function mock(){
  const calls=[];
  const pool={async query(sql,args){
    calls.push({sql,args});
    if(sql.includes('SELECT c.*'))return {rows:[sample]};
    if(sql.includes('COUNT(*)::int AS count'))return {rows:[{count:1}]};
    if(sql.includes('COUNT(*)::int AS total'))return {rows:[{
      total:11,unused:5,redeemed:6,revoked:0
    }]};
    if(sql.includes('WHERE id=$1 LIMIT 1'))return {rows:[sample]};
    throw Error('unexpected_query');
  }};
  return {calls,service:createStreamDurationCodes({pool,keyHex:key})};
}
test('global inventory search matches original legacy code by HMAC, never interpolating plaintext into SQL',async()=>{
  const {calls,service}=mock();
  const result=await service.search({query:oldCode,status:'all',limit:40,offset:0});
  assert.equal(result.ok,true);
  assert.equal(result.searchApplied,true);
  assert.equal(result.filteredTotal,1);
  assert.equal(result.nextOffset,null);
  assert.equal(result.totals.total,11);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,id);
  assert.equal(result.items[0].codeHint,'AB••••56');
  assert.equal(calls.length,3);
  assert.ok(calls[0].sql.includes('code_hash=$2'));
  assert.ok(calls[0].sql.includes('buyer_phone'));
  assert.ok(calls[0].sql.includes('label'));
  assert.deepEqual(calls[0].args.slice(0,2),[oldCode,streamCodeProof(oldCode,key)]);
  assert.deepEqual(calls[0].args.slice(-2),[40,0]);
  assert.ok(!calls.some(c=>c.sql.includes(oldCode)));
  const printed=JSON.stringify(result);
  assert.ok(!printed.includes(oldCode));
  assert.ok(!printed.includes('private-vault-must-not-leak'));
});
test('global voucher search can find by phone and filter all historical records, without skipping other pages',async()=>{
  const {calls,service}=mock();
  const result=await service.search({query:'٠٥٥١٢٣٤٥٦٧',status:'unused',limit:40,offset:0});
  assert.equal(result.filteredTotal,1);
  assert.equal(calls[0].args[0],'0551234567');
  assert.match(calls[0].sql,/c\.redeemed_at IS NULL AND c\.revoked_at IS NULL/);
  assert.match(calls[0].sql,/ORDER BY c\.created_at DESC,c\.id DESC/);
  assert.equal(result.totals.unused,5,'summary totals remain global, not just search result');
});
test('invalid search status, query or pagination is rejected before database access',async()=>{
  const {calls,service}=mock();
  for(const payload of [
    {query:'A'}, {query:'x'.repeat(101)},
    {query:'\0evil'},
    {query:'خالد',status:'all;DROP TABLE'},
    {query:'0551234567',limit:41},
    {query:'0551234567',offset:-1}
  ])await assert.rejects(service.search(payload),/stream_search_/);
  assert.equal(calls.length,0);
});
test('protected exact-ID code read returns safe data with no password, vault or plaintext code',async()=>{
  const {calls,service}=mock();
  const data=await service.getRecord(id);
  assert.equal(data.ok,true);
  assert.equal(data.item.id,id);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].args,[id]);
  assert.ok(!JSON.stringify(data).includes('private-vault-must-not-leak'));
  await assert.rejects(service.getRecord('invalid'),/stream_code_id_invalid/);
});
test('admin gateway and BLOFY ONE browser keep exact secret vouchers out of URLs',async()=>{
  const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
  const [hook,ui,html,manager]=await Promise.all([
    read('src/xtream-gateway-hook.mjs'),read('web/blofy-one-stream.js'),
    read('web/blofy-one.html'),read('web/blofy-one-code-manager.js')
  ]);
  assert.doesNotThrow(()=>new Script(ui));
  assert.doesNotThrow(()=>new Script(manager));
  assert.match(hook,/url\.pathname==='\/api\/v1\/admin\/xtream-gateway\/codes\/search'/);
  assert.match(hook,/streamCodes\.search\(/);
  assert.match(hook,/streamCodes\.getRecord\(codeDetail\[1\]\)/);
  assert.match(ui,/method:'POST',body:\{query,status:filter,offset:codeOffset,limit:pageSize\}/);
  assert.match(ui,/codeSearchRemote=remote/);
  assert.match(ui,/result\.filteredTotal/);
  assert.match(ui,/new CustomEvent\('blofy-one:manage-code'/);
  assert.match(manager,/request\(root\+'\/\'+encodeURIComponent\(id\)\)/);
  assert.match(html,/بحث في جميع الأكواد/);
  assert.doesNotMatch(ui,/localStorage|sessionStorage|innerHTML\s*=/);
  assert.doesNotMatch(manager,/localStorage|sessionStorage/);
});
