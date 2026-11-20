import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAuthorizedApplePayPilot} from '../src/store-apple-pay-pilot.mjs';

const token='Apple_Pay_Test_Only_8NoBypass_012345678901';
const now=Date.parse('2026-11-20T12:00:00.000Z');
const config={
 BLOFY_GEIDEA_APPLE_PAY_PILOT_ENABLED:'true',
 BLOFY_GEIDEA_APPLE_PAY_PILOT_TOKEN_SHA256:crypto.createHash('sha256').update(token).digest('hex'),
 BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT:'2026-11-26T12:00:00.000Z'
};
test('private owner pilot permits only the exact bearer while unexpired',()=>{
 assert.equal(isAuthorizedApplePayPilot(config,token,now),true);
 for(const invalid of ['','notvalid','x'.repeat(45),'#'+token,token+'-'])
  assert.equal(isAuthorizedApplePayPilot(config,invalid,now),false);
 assert.equal(isAuthorizedApplePayPilot({...config,BLOFY_GEIDEA_APPLE_PAY_PILOT_ENABLED:'false'},token,now),false);
 assert.equal(isAuthorizedApplePayPilot({...config,BLOFY_GEIDEA_APPLE_PAY_PILOT_TOKEN_SHA256:'wrong'},token,now),false);
 assert.equal(isAuthorizedApplePayPilot({...config,BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT:''},token,now),false);
 assert.equal(isAuthorizedApplePayPilot(config,token,Date.parse(config.BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT)),false);
 assert.equal(isAuthorizedApplePayPilot({...config,BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT:'2026-12-30T12:00:00Z'},token,now),false);
});
test('pilot never bypasses customer verification, live captured payment or wallet-matching checks',()=>{
 const code=readFileSync(new URL('../src/store-geidea-checkout.mjs',import.meta.url),'utf8');
 assert.match(code,/requireCheckoutCustomer\(req\)/);
 assert.match(code,/pg_advisory_xact_lock/);
 assert.match(code,/apple_pay_test=TRUE/);
 assert.match(code,/config\.applePayEnabled\|\|original\.apple_pay_test===true/);
 assert.match(code,/verifiedPayment\(settled,original/);
 assert.match(code,/pilotApplePay\?\[\]:geideaHiddenWallets\(env\)/);
});
