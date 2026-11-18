import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyResendFailure,checkResendSender,resendSenderDomain} from '../src/store-customer-resend.mjs';

test('redacts provider errors while retaining actionable failure categories',()=>{
 assert.deepEqual(classifyResendFailure(401,{name:'invalid_api_key',message:'api token hidden'}),
  {clientCode:'customer_email_key_invalid',reason:'invalid_api_key'});
 assert.deepEqual(classifyResendFailure(403,{name:'validation_error',
  message:'Domain blofyplayer.com is not verified. Please verify your domain.'}),
  {clientCode:'customer_email_domain_unverified',reason:'domain_unverified'});
 assert.deepEqual(classifyResendFailure(403,{name:'validation_error',
  message:'You can only send testing emails to your own email address.'}),
  {clientCode:'customer_email_sender_restricted',reason:'sender_restricted'});
 assert.deepEqual(classifyResendFailure(429,{name:'rate_limit_exceeded'}),
  {clientCode:'customer_email_provider_rate_limited',reason:'provider_rate_limit'});
 const unknown=classifyResendFailure(500,{name:'server_error',message:'SECRET-DO-NOT-LEAK'});
 assert.deepEqual(unknown,{clientCode:'customer_email_unavailable',reason:'provider_unavailable'});
 assert.equal(JSON.stringify(unknown).includes('SECRET-DO-NOT-LEAK'),false);
});
test('sender readiness query honors exact configured domain, no leaking access token or other domains',async()=>{
 assert.equal(resendSenderDomain('BLOFY <support@blofyplayer.com>'),'blofyplayer.com');
 const env={mailKey:'re_fake_secret',mailFrom:'BLOFY <support@blofyplayer.com>'};
 let requested=0;
 const fetchImpl=async(url,opts)=>{
  requested++;
  assert.equal(url,'https://api.resend.com/domains?limit=100');
  assert.equal(opts.headers.authorization,'Bearer re_fake_secret');
  return {ok:true,status:200,json:async()=>({data:[
   {name:'other.example',status:'verified'},
   {name:'blofyplayer.com',status:'verified'}]})};
 };
 const good=await checkResendSender({...env,fetchImpl});
 assert.deepEqual(good,{status:'verified',domain:'blofyplayer.com',verificationStatus:'verified'});
 assert.equal(JSON.stringify(good).includes('re_fake_secret'),false);
 assert.equal(JSON.stringify(good).includes('other.example'),false);
 assert.equal(requested,1);
});
test('send-only scope is inconclusive; explicit domain rejection is recognized',async()=>{
 const basic={mailKey:'re_fake_secret',mailFrom:'BLOFY <support@blofyplayer.com>'};
 const unauthorized=await checkResendSender({...basic,fetchImpl:async()=>({status:401,ok:false})});
 assert.deepEqual(unauthorized,{status:'key_inspection_unauthorized',domain:'blofyplayer.com'});
 const forbidden=await checkResendSender({...basic,fetchImpl:async()=>({status:403,ok:false})});
 assert.deepEqual(forbidden,{status:'key_send_only_cannot_inspect',domain:'blofyplayer.com'});
 const unverified=await checkResendSender({...basic,fetchImpl:async()=>({status:200,ok:true,json:async()=>({data:[
  {name:'blofyplayer.com',status:'pending'}]})})});
 assert.deepEqual(unverified,{status:'sender_domain_not_verified',domain:'blofyplayer.com',verificationStatus:'pending'});
});
