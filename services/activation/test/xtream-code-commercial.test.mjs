import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamCommercial,validSaleData,validExtension,
  ensureStreamCommercialSchema} from '../src/xtream-code-commercial.mjs';
import {createStreamAppToken,verifyStreamAppToken} from '../src/xtream-code-app-token.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';

const keyHex='c'.repeat(64);
const id='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const accountId='d2bb0397-1c56-4751-adc9-1a17758022f6';
const current=Date.parse('2026-11-09T05:00:00Z');
function mock(){
  const code={id,code_hash:streamCodeProof('12345678',keyHex),
    code_hint:'12••••78',code_channel:'app',duration_days:30,
    max_connections:1,account_id:accountId,
    redeemed_at:new Date(current-10*86400000),
    redeemed_device_hash:'b'.repeat(64),expires_at:new Date(current+20*86400000),
    revoked_at:null,transfer_count:0,extended_days:0};
  const account={id:accountId,enabled:true,expires_at:new Date(code.expires_at)};
  const queries=[],events=[];
  async function query(sql,args=[]){
    queries.push({sql,args});
    if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
    if(sql.startsWith('ALTER TABLE')||sql.startsWith('CREATE TABLE')||
       sql.startsWith('CREATE INDEX'))return {rows:[]};
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
    if(sql.includes('SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'))
      return {rows:[{count:100}]};
    if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('FOR UPDATE'))
      return {rows:args[0]===id?[code]:[]};
    if(sql.includes('FROM blofy_xtream_gateway_accounts')&&sql.includes('FOR UPDATE'))
      return {rows:args[0]===accountId?[account]:[]};
    if(sql.includes('SELECT 1 FROM blofy_xtream_gateway_duration_codes'))
      return {rows:args[0]===code.code_hash?[{}]:[]};
    if(sql.includes('INSERT INTO blofy_xtream_gateway_code_events')){
      events.push(args);return {rows:[]};
    }
    if(sql.includes('SET buyer_name=')){
      if(code.sold_at!==undefined&&code.sold_at!==null)return {rows:[]};
      Object.assign(code,{buyer_name:args[1],buyer_phone:args[2],
        sale_price_halalas:args[3],sales_channel:args[4],
        sold_at:new Date(current)});
      return {rows:[code]};
    }
    if(sql.includes('SET expires_at=$2,updated_at=NOW()')){
      account.expires_at=args[1];return {rows:[]};
    }
    if(sql.includes('SET expires_at=$2,extended_days=')){
      code.expires_at=args[1];code.extended_days+=args[2];
      return {rows:[code]};
    }
    if(sql.includes('SET code_hash=$2')){
      code.code_hash=args[1];code.code_hint=args[2];
      code.redeemed_device_hash=null;code.transfer_count++;
      code.last_transfer_at=new Date(current);return {rows:[code]};
    }
    if(sql.includes('AS recorded_revenue_halalas'))
      return {rows:[{total:1,app_codes:1,unused:0,redeemed:1,sold:code.sold_at?1:0,
        recorded_revenue_halalas:String(code.sale_price_halalas||0),
        expiring_soon:0,transfers:code.transfer_count}]};
    throw Error('Unexpected SQL: '+sql);
  }
  const pool={query,async connect(){return {query,release(){}}}};
  return {code,account,pool,queries,events};
}

test('sales validate SAR currency and contact details without exposing payment credentials',()=>{
  assert.deepEqual(validSaleData({priceSar:'70',buyerName:'Client',
    buyerPhone:'+966512345678',channel:'manual'}),
    {priceHalalas:7000,buyerName:'Client',buyerPhone:'+966512345678',channel:'manual'});
  for(const priceSar of [-1,NaN,Infinity,'wrong',100001,12.345])
    assert.throws(()=>validSaleData({priceSar}),/stream_sale_price_invalid/);
  assert.throws(()=>validSaleData({priceSar:1,buyerPhone:'hello'}),/stream_sale_phone_invalid/);
  assert.equal(validExtension({days:1}),1);
  for(const days of [0,-1,731,1.4,'bad'])
    assert.throws(()=>validExtension({days}),/stream_extension_days_invalid/);
});
test('manual sale is recorded exactly once, revenue is a ledger not payment',async()=>{
  const d=mock(),manager=createStreamCommercial({pool:d.pool,keyHex,clock:()=>current});
  const sale=await manager.markSold(id,{priceSar:70,buyerName:'Customer',
    buyerPhone:'+966512345678',channel:'manual'});
  assert.equal(sale.item.salePriceHalalas,7000);
  assert.equal(sale.item.soldAt,current);
  const stats=await manager.salesSummary();
  assert.equal(stats.currency,'SAR');
  assert.equal(stats.recorded_revenue_halalas,'7000');
  assert.equal(d.events.length,1);
  await assert.rejects(manager.markSold(id,{priceSar:30}),
    /stream_sale_already_recorded_or_missing/);
});
test('extension starts from existing expiry not a new activation time',async()=>{
  const d=mock(),manager=createStreamCommercial({pool:d.pool,keyHex,clock:()=>current});
  const activatedAt=d.code.redeemed_at.getTime();
  const before=d.code.expires_at.getTime();
  const result=await manager.extend(id,{days:30});
  assert.equal(d.code.expires_at.getTime(),before+30*86400000);
  assert.equal(d.account.expires_at.getTime(),before+30*86400000);
  assert.equal(d.code.redeemed_at.getTime(),activatedAt);
  assert.equal(result.item.extendedDays,30);
  assert.equal(d.events[0][2],'extended');
});
test('device transfer rotates code and invalidates the old bearer without extending expiry',async()=>{
  const d=mock(),manager=createStreamCommercial({pool:d.pool,keyHex,
    clock:()=>current,randomBytes:(n)=>Buffer.alloc(n,41)});
  const oldToken=createStreamAppToken({
    account_id:accountId,code_hash:d.code.code_hash,
    redeemed_device_hash:d.code.redeemed_device_hash},keyHex);
  const before=d.code.expires_at.getTime();
  const activation=d.code.redeemed_at.getTime();
  const result=await manager.reissueForDeviceTransfer(id);
  assert.match(result.code,/^[0-9]{9}$/);
  assert.equal(result.durationUnchanged,true);
  assert.equal(result.item.deviceTransferPending,true);
  assert.equal(d.code.redeemed_device_hash,null);
  assert.equal(d.code.expires_at.getTime(),before);
  assert.equal(d.code.redeemed_at.getTime(),activation);
  assert.equal(d.code.transfer_count,1);
  assert.equal(verifyStreamAppToken(oldToken,{
    account_id:accountId,code_hash:d.code.code_hash,
    redeemed_device_hash:'b'.repeat(64)},keyHex),false);
  assert.equal(d.events[0][2],'device_transfer_code_reissued');
  await assert.rejects(manager.reissueForDeviceTransfer(id),/stream_transfer_unavailable/);
});
test('expired subscriptions cannot be moved onto fresh devices',async()=>{
  const d=mock(),manager=createStreamCommercial({pool:d.pool,keyHex,clock:()=>current});
  d.code.expires_at=new Date(current-1);
  await assert.rejects(manager.reissueForDeviceTransfer(id),/stream_transfer_unavailable/);
  assert.equal(d.events.length,0);
});
test('commercial schema is additive and audit-log-only',async()=>{
  const d=mock();
  await ensureStreamCommercialSchema(d.pool);
  assert.ok(d.queries.some(x=>x.sql.includes('blofy_xtream_gateway_code_events')));
  assert.ok(d.queries.some(x=>x.sql.includes('transfer_count INTEGER')));
  assert.equal(d.queries.filter(x=>x.sql.startsWith('DROP ')).length,0);
});
