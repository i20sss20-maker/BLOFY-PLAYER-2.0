import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readOneSalesSummary,ONE_SALES_QUERY} from '../src/one-sales-overview.mjs';

const read=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');
test('recorded sales summary counts only the actual SAR subscription order ledger without payer details', async()=>{
  let executed='';
  const pool={async query(sql){executed=sql;return {rows:[{
    total_orders:'12',paid_orders:'7',pending_orders:'2',failed_orders:'1',
    cancelled_orders:'1',refunded_orders:'1',paid_30d:'4',
    recorded_paid_minor:'70099',paid_30d_minor:'40050'
  }]}}};
  const out=await readOneSalesSummary(pool,()=>new Date('2026-11-18T00:00:00Z'));
  assert.equal(out.scope,'BLOFY_PLAYER_device_activation_orders_only');
  assert.equal(out.currency,'SAR');
  assert.equal(out.orders.paid,7);
  assert.equal(out.orders.refunded,1);
  assert.equal(out.orders.paidLast30Days,4);
  assert.equal(out.value.recordedPaidSar,'700.99');
  assert.equal(out.value.paidLast30DaysSar,'400.50');
  assert.equal(out.calculatedAt,'2026-11-18T00:00:00.000Z');
  assert.match(executed,/FROM subscription_orders/);
  assert.match(executed,/WHERE currency = 'SAR'/);
  assert.match(executed,/WHERE status = 'paid'/);
  assert.match(executed,/paid_at >= NOW\(\) - INTERVAL '30 days'/);
  assert.doesNotMatch(executed,/device_id|customer_phone|customer_email|provider_reference|SELECT \*/);
  assert.doesNotMatch(JSON.stringify(out),/device_id|phone|email|card|provider_reference/);
});
test('sales values are never fabricated when a counter or amount is invalid',async()=>{
  const mock={query:async()=>({rows:[{
    total_orders:'bad',paid_orders:'0',pending_orders:'0',failed_orders:'0',
    cancelled_orders:'0',refunded_orders:'0',paid_30d:'0',
    recorded_paid_minor:'invalid',paid_30d_minor:'0'
  }]})};
  const out=await readOneSalesSummary(mock);
  assert.equal(out.orders.total,null);
  assert.equal(out.orders.paid,0);
  assert.equal(out.value.recordedPaidSar,null);
  assert.equal(out.value.paidLast30DaysSar,'0.00');
  await assert.rejects(()=>readOneSalesSummary({query:async()=>({rows:[]})}));
});
test('sale dashboard is protected admin-only GET and reports genuine PLAYER-only scope',async()=>{
  const [handler,html,js,css]=await Promise.all([
    read('src/admin-console-hook.mjs'),read('web/blofy-one.html'),
    read('web/blofy-one.js'),read('web/blofy-one.css')
  ]);
  assert.match(handler,/url\.pathname === '\/api\/v1\/admin\/one\/sales' && req\.method === 'GET'/);
  assert.match(handler,/if \(!requireAdmin\(req, res\)\) return;/);
  assert.match(handler,/await readOneSalesSummary\(pool\)/);
  assert.match(js,/readJson\('\/api\/v1\/admin\/one\/sales'\)/);
  assert.match(js,/BLOFY_PLAYER_device_activation_orders_only/);
  assert.match(html,/id="one-sales-gross"/);
  assert.match(html,/id="one-sales-30d"/);
  assert.match(html,/id="one-sales-paid"/);
  assert.match(html,/لا تشمل مبيعات BLOFY STREAM/);
  assert.match(html,/لا تعني المبالغ تسوية من البنك/);
  assert.match(css,/\.one-sales-metrics/);
  assert.doesNotMatch(js,/\/api\/v1\/admin\/one\/sales[^'"]*POST/);
  assert.doesNotMatch(ONE_SALES_QUERY,/UPDATE |DELETE |INSERT |FOR UPDATE/i);
});
