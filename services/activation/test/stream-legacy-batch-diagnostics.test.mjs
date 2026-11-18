import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {createStreamCodeXtreamLink} from '../src/xtream-code-dual-link.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {encryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';

const KEY='be'.repeat(32);
const NOW=Date.parse('2026-11-18T12:00:00.000Z');
const FUTURE=new Date(NOW+20*86400000).toISOString();
const EXPIRED=new Date(NOW-86400000).toISOString();
const A='49e7e9e5-4c18-4caa-a14e-e51ab39d8ba9';
const SALEH='d2bb0397-1c56-4751-adc9-1a17758022f6';
const LEGACY='ABCDEF123456ABCDEF123456';
const NUMERIC='87654321';
const PASSWORD_MISSING='12345678';
const OTHER_SOURCE='11223344';
const REVOKED='AABBCCDDEEFF112233445566';
const EXPIRE_CODE='77889900';
const UNUSED='98765432';
const ABSENT='99887766';
const vault=encryptGatewayAccountPassword(A,'localPass456',KEY);
const row=(code,override={})=>({
  code_hash:streamCodeProof(code,KEY),code_hint:code.slice(0,2)+'••••'+code.slice(-2),
  redeemed_at:new Date(NOW-86400000).toISOString(),revoked_at:null,
  voucher_expiry:FUTURE,account_id:A,account_identity:A,
  username:'BLOFYOLD123',enabled:true,account_expiry:FUTURE,
  source_id:SALEH,credential_vault:vault,...override
});
function stub(list){
  const calls=[];
  return {
    calls,
    pool:{async query(sql,args){
      calls.push({sql,args});
      return {rows:list.filter(v=>args[0].includes(v.code_hash))};
    }}
  };
}
test('batch inspection covers 24-character old vouchers, numeric codes and known failure reasons without secrets',async()=>{
  const records=[
    row(LEGACY),row(NUMERIC),
    row(PASSWORD_MISSING,{credential_vault:null}),
    row(OTHER_SOURCE,{source_id:'d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a'}),
    row(REVOKED,{revoked_at:new Date(NOW-10000).toISOString()}),
    row(EXPIRE_CODE,{voucher_expiry:EXPIRED}),
    row(UNUSED,{redeemed_at:null,account_id:null,account_identity:null})
  ];
  const {pool,calls}=stub(records);
  const inspect=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW}).inspectBatch;
  const codes=[LEGACY,NUMERIC,PASSWORD_MISSING,OTHER_SOURCE,REVOKED,EXPIRE_CODE,UNUSED,ABSENT];
  const result=await inspect({codes});
  assert.equal(result.ok,true);
  assert.equal(result.readOnly,true);
  assert.equal(result.scanned,8);
  assert.equal(result.ready,2);
  assert.deepEqual(result.results.map(v=>v.status),[
    'ready','ready','password_unrecoverable','unsupported_source',
    'revoked','expired','not_activated','not_found'
  ]);
  assert.deepEqual(result.results.map(v=>v.canExtract),[true,true,false,false,false,false,false,false]);
  assert.equal(result.results[0].kind,'legacy_24_hex');
  assert.equal(result.results[1].kind,'numeric');
  assert.equal(result.results[0].expiresAt,Date.parse(FUTURE));
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/code_hash=ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(calls[0].sql,/INSERT|UPDATE|DELETE|RETURNING/);
  assert.deepEqual(calls[0].args,[codes.map(c=>streamCodeProof(c,KEY))]);
  const exposed=JSON.stringify(result);
  for(const code of codes)assert.ok(!exposed.includes(code),'raw code must never appear in batch response');
  assert.ok(!exposed.includes('localPass456'));
  assert.ok(!exposed.includes(vault));
});
test('batch rejects excessive, malformed or duplicated vouchers before querying',async()=>{
  const {pool,calls}=stub([]);
  const inspect=createStreamCodeXtreamLink({pool,keyHex:KEY}).inspectBatch;
  for(const invalid of [
    [],Array.from({length:21},(_,i)=>String(i).padStart(8,'0')),
    [NUMERIC,NUMERIC],['123456'],['invalid-code']
  ])await assert.rejects(inspect({codes:invalid}),/stream_link_batch_/);
  assert.equal(calls.length,0);
});
test('batch route and UI are admin-scoped, no bulk password export or in-browser persistence',async()=>{
  const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
  const [server,script,html,styles]=await Promise.all([
    read('src/xtream-gateway-hook.mjs'),read('web/blofy-one-legacy.js'),
    read('web/blofy-one.html'),read('web/blofy-one-legacy.css')
  ]);
  assert.doesNotThrow(()=>new Script(script));
  assert.match(server,/\'\/api\/v1\/admin\/xtream-gateway\/codes\/inspect-batch\'/);
  assert.match(server,/await streamDualLink\.inspectBatch\(\{codes:payload\.codes\}\)/);
  assert.ok(server.indexOf('if (!requireAdmin(req, res)) return;')<
    server.indexOf('/api/v1/admin/xtream-gateway/codes/inspect-batch'));
  assert.match(html,/id="one-legacy-batch-form"/);
  assert.match(html,/id="one-legacy-batch-results"/);
  assert.match(script,/\/api\/v1\/admin\/xtream-gateway\/codes\/inspect-batch/);
  assert.match(script,/form\.requestSubmit\(\)/);
  assert.match(script,/window\.setTimeout\(\(\)=>clearBatch\(/);
  assert.match(script,/180000/);
  assert.match(styles,/\.one-legacy-batch-table/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|console\.log|\/api\/v1\/stream\/redeem/);
});
