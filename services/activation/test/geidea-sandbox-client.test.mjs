import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGeideaSandboxSession } from '../src/geidea-sandbox-client.mjs';

const ref = crypto.randomUUID();
const key = crypto.randomUUID();
const secret = 'test-secret-not-production';
const opts = {
  enabled: true, plan: {priceMinor:150,currency:'SAR'},
  merchantReferenceId:ref, timestamp:'2026/10/22 20:00:00',
  merchantPublicKey:key, apiPassword:secret,
  callbackUrl:'https://example.org/test-callback',
  returnUrl:'https://example.org/result',
};

test('sandbox is disabled by default and does not request anything',async()=>{
  let called = false;
  await assert.rejects(createGeideaSandboxSession({
    ...opts, enabled:false,
    fetchImpl: async()=>{called=true;return {};}
  }),/geidea_test_disabled/);
  assert.equal(called,false);
});

test('creates valid KSA test session, authenticates server side, returns safe subset',async()=>{
  const sid=crypto.randomUUID();
  let calls=0;
  const result=await createGeideaSandboxSession({
    ...opts,
    fetchImpl:async(url,req)=>{
      calls++;
      assert.equal(url,'https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session');
      assert.equal(req.method,'POST');
      assert.equal(req.headers.authorization,'Basic '+Buffer.from(key+':'+secret).toString('base64'));
      const p=JSON.parse(req.body);
      assert.equal(p.amount,'1.50');
      assert.equal(p.currency,'SAR');
      assert.equal(p.merchantReferenceId,ref);
      assert.ok(p.signature);
      return {ok:true,json:async()=>({
        responseCode:'000',detailedResponseCode:'000',
        session:{id:sid,amount:1.5,currency:'SAR',merchantReferenceId:ref,expiryDate:'2026-10-22T20:15:00Z'}
      })};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.sessionId,sid);
  assert.ok(result.checkoutUrl.endsWith('/?'+sid));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('rejects mismatched amount, currency, reference, and invalid session ID',async()=>{
  for(const session of [
    {id:crypto.randomUUID(),amount:9.99,currency:'SAR'},
    {id:crypto.randomUUID(),amount:1.5,currency:'USD'},
    {id:crypto.randomUUID(),amount:1.5,currency:'SAR',merchantReferenceId:crypto.randomUUID()},
    {id:'bad',amount:1.5,currency:'SAR'},
  ]) {
    await assert.rejects(
      createGeideaSandboxSession({...opts,fetchImpl:async()=>({
        ok:true,json:async()=>({responseCode:'000',detailedResponseCode:'000',session})
      })}),
      /geidea_session_mismatch|geidea_session_invalid_response/
    );
  }
});

test('provider declines, errors, and network problems never leak secrets',async()=>{
  const cases=[
    async()=>({ok:false,status:401}),
    async()=>({ok:true,json:async()=>({responseCode:'999',detailedResponseCode:'001'})}),
    async()=>{throw new Error('do not leak '+secret);}
  ];
  for(const fetchImpl of cases) {
    await assert.rejects(
      createGeideaSandboxSession({...opts,fetchImpl}),
      error=> {
        assert.ok(!error.message.includes(secret));
        return /^geidea_/.test(error.message);
      }
    );
  }
});

test('invalid plan or URLs cannot start external request',async()=>{
  let called=false;
  await assert.rejects(createGeideaSandboxSession({
    ...opts, plan:{priceMinor:0,currency:'SAR'},
    fetchImpl:async()=>{called=true;}
  }),/invalid_geidea_plan/);
  await assert.rejects(createGeideaSandboxSession({
    ...opts,callbackUrl:'http://example.org/',
    fetchImpl:async()=>{called=true;}
  }),/invalid_geidea_url/);
  assert.equal(called,false);
});
