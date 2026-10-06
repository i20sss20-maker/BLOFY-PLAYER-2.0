import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDeviceIdFromProduct,
  extractZidOrder,
  matchZidPlan,
  parseZidProducts
} from '../src/zid-payments.mjs';

test('Zid product configuration maps store products to BLOFY durations', () => {
  const plans = parseZidProducts(JSON.stringify([
    {
      planKey: 'zid-quarter',
      name: 'BLOFY PLAYER - 3 months',
      durationDays: 90,
      productId: 'product_123456',
      sku: 'BLOFY-PLAYER-3M',
      productUrl: 'https://blofy-sat.zid.store/products/blofy-player-3m',
      priceLabel: '45 ر.س'
    },
    {
      planKey: 'zid-year',
      name: 'BLOFY PLAYER - 1 year',
      durationDays: 365,
      productId: 'product_987654',
      sku: 'BLOFY-PLAYER-1Y',
      active: false
    }
  ]));
  assert.equal(plans.length, 2);
  assert.equal(plans[0].durationDays, 90);
  assert.equal(plans[0].productUrl, 'https://blofy-sat.zid.store/products/blofy-player-3m');
  assert.equal(plans[1].active, false);
});

test('Zid product configuration rejects unsafe or incomplete entries', () => {
  assert.throws(
    () => parseZidProducts(JSON.stringify([{ planKey: 'bad', name: 'x', durationDays: 90, sku: 'SKU' }])),
    /invalid_zid_product/
  );
  assert.throws(
    () => parseZidProducts(JSON.stringify([{ planKey: 'zid-test', name: 'x', durationDays: 0, sku: 'SKU' }])),
    /invalid_zid_product/
  );
  assert.throws(
    () => parseZidProducts(JSON.stringify([{ planKey: 'zid-test', name: 'x', durationDays: 90, productUrl: 'http://example.com', sku: 'SKU' }])),
    /invalid_zid_product/
  );
});

test('Zid webhook order extraction accepts common envelope shapes', () => {
  assert.equal(extractZidOrder({ data: { order: { id: 1 } } }).id, 1);
  assert.equal(extractZidOrder({ order: { id: 2 } }).id, 2);
  assert.equal(extractZidOrder({ data: { id: 3, products: [] } }).id, 3);
  assert.equal(extractZidOrder({ id: 4 }).id, 4);
});

test('Zid device id is read from order product custom fields', () => {
  const product = {
    custom_fields: [
      { label: 'رقم جهاز BLOFY PLAYER', value: 'blofy-66hl-gb09' }
    ]
  };
  assert.equal(extractDeviceIdFromProduct(product), 'BLOFY-66HL-GB09');
});

test('Zid plan match prefers exact product id or SKU', () => {
  const plans = parseZidProducts(JSON.stringify([
    { planKey: 'zid-quarter', name: '3 months', durationDays: 90, productId: 'prod_123456', sku: 'BLOFY-PLAYER-3M' }
  ]));
  assert.equal(matchZidPlan({ id: 'prod_123456', sku: 'OTHER' }, plans)?.planKey, 'zid-quarter');
  assert.equal(matchZidPlan({ id: 'other_123456', sku: 'BLOFY-PLAYER-3M' }, plans)?.planKey, 'zid-quarter');
  assert.equal(matchZidPlan({ id: 'other_123456', sku: 'NOPE' }, plans), null);
});
