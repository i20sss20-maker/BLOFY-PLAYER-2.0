import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  parseGeideaPlans, buildGeideaSessionDraft,
  GEIDEA_KSA_SESSION_URL, GEIDEA_KSA_HPP_SCRIPT_URL,
} from '../src/geidea-preflight.mjs';

const plans = JSON.stringify([{planKey:'geidea-3m',name:'3 months',priceMinor:1000,durationDays:90,currency:'SAR'}]);
const plan = parseGeideaPlans(plans)[0];
const options = {
  plan, merchantReferenceId:'30e6b8fd-d946-48f2-8ba0-bcc54e724e20',
  timestamp:'2026/10/19 18:00:00',
  merchantPublicKey:'b95ecc74-dccd-4a3c-b3e5-7c492df8a4e8',
  apiPassword:'test-api-password-not-production',
  callbackUrl:'https://api.blofyplayer.com/api/v1/payments/geidea/callback',
  returnUrl:'https://blofysat.com/payment-result',
};

test('uses official KSA session and checkout hosts',()=>{
  assert.match(GEIDEA_KSA_SESSION_URL, /^https:\/\/api\.ksamerchant\.geidea\.net\//);
  assert.match(GEIDEA_KSA_HPP_SCRIPT_URL, /^https:\/\/www\.ksamerchant\.geidea\.net\//);
});
test('plans require positive approved SAR prices',()=>{
  assert.equal(plan.priceMinor,1000);
  for(const bad of [0,-100,1.5,'1000']) {
    assert.throws(()=>parseGeideaPlans(JSON.stringify([{...plan,priceMinor:bad}])),/invalid_geidea_plan/);
  }
  assert.throws(()=>parseGeideaPlans(JSON.stringify([{...plan,currency:'USD'}])),/invalid_geidea_plan/);
});
test('rejects duplicate plans and invalid JSON',()=>{
  assert.throws(()=>parseGeideaPlans('bad json'),/invalid_geidea_plans_json/);
  assert.throws(()=>parseGeideaPlans(JSON.stringify([plan,plan])),/invalid_geidea_plan/);
});
test('creates exact two-decimal signature with server credentials',()=>{
  const draft=buildGeideaSessionDraft(options);
  const expected=crypto.createHmac('sha256',options.apiPassword)
    .update(options.merchantPublicKey+'10.00SAR'+options.merchantReferenceId+options.timestamp)
    .digest('base64');
  assert.equal(draft.signature,expected);
  assert.equal(draft.amount,'10.00');
  assert.equal(draft.language,'ar');
});
test('ignores buyer pricing: draft derives amount from allowlisted plan',()=>{
  const draft=buildGeideaSessionDraft({...options, amount:0.01, currency:'USD'});
  assert.equal(draft.amount,'10.00');
  assert.equal(draft.currency,'SAR');
});
test('blocks malformed callback/return URLs and references',()=>{
  assert.throws(()=>buildGeideaSessionDraft({...options,callbackUrl:'http://example.com/pay'}),/invalid_geidea_url/);
  assert.throws(()=>buildGeideaSessionDraft({...options,returnUrl:'https://user:pw@example.com/'}),/invalid_geidea_url/);
  assert.throws(()=>buildGeideaSessionDraft({...options,merchantReferenceId:'random'}),/invalid_geidea_reference/);
  assert.throws(()=>buildGeideaSessionDraft({...options,apiPassword:''}),/geidea_credentials_missing/);
});
