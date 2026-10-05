import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { formatTapAmount, tapWebhookHash } from '../src/tap-payments.mjs';

test('Tap amount formatting follows currency minor units',()=>{
  assert.equal(formatTapAmount(1,'SAR'),'1.00');
  assert.equal(formatTapAmount(12.5,'USD'),'12.50');
  assert.equal(formatTapAmount(1,'KWD'),'1.000');
  assert.equal(formatTapAmount(2.345,'BHD'),'2.345');
});

test('Tap webhook hashstring uses the documented charge fields in order',()=>{
  const payload={
    id:'chg_test_123456',
    amount:1,
    currency:'SAR',
    status:'CAPTURED',
    transaction:{created:'1760000000000'},
    reference:{gateway:'gw_ref_1',payment:'pay_ref_1'}
  };
  const secret='sk_test_fixture_only';
  const source='x_idchg_test_123456x_amount1.00x_currencySARx_gateway_referencegw_ref_1x_payment_referencepay_ref_1x_statusCAPTUREDx_created1760000000000';
  const expected=crypto.createHmac('sha256',secret).update(source).digest('hex');
  assert.equal(tapWebhookHash(payload,secret),expected);
});

test('Tap webhook hashstring treats missing gateway reference as empty',()=>{
  const payload={
    id:'chg_test_654321',
    amount:9.9,
    currency:'SAR',
    status:'FAILED',
    transaction:{created:1760000000001},
    reference:{payment:'pay_ref_2'}
  };
  const secret='sk_test_fixture_only';
  const source='x_idchg_test_654321x_amount9.90x_currencySARx_gateway_referencex_payment_referencepay_ref_2x_statusFAILEDx_created1760000000001';
  const expected=crypto.createHmac('sha256',secret).update(source).digest('hex');
  assert.equal(tapWebhookHash(payload,secret),expected);
});
