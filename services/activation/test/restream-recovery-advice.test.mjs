import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackRecoveryAdvice,summarizeRecoveryAdvice} from '../src/restream-recovery-advice.mjs';
test('explicit provider and concurrent session denials never trigger retry or failover',()=>{
 for(const code of ['upstream_http_403','upstream_http_429','upstream_http_456','upstream_denial_cooldown','gateway_auth_denied']){
  const a=playbackRecoveryAdvice({reason:code,hasAuthorizedBackup:true});
  assert.equal(a.automaticRetry,false);
  assert.equal(a.allowFailover,false);
  assert.equal(a.class,'provider_or_auth_denial');
 }
});
test('404 is classified for review rather than retried as a network error',()=>{
 const a=playbackRecoveryAdvice({reason:'upstream_http_404'});
 assert.equal(a.class,'missing_media');assert.equal(a.action,'operator_review');
});
test('bounded network problems have cooldown hints, not provider probes',()=>{
 assert.equal(playbackRecoveryAdvice({reason:'media_read_timeout',attempts:3}).action,'cooldown');
 assert.equal(playbackRecoveryAdvice({reason:'upstream_http_503',attempts:0}).automaticRetry,false);
});
test('summary redacts source metadata and never suggests automatic recovery',()=>{
 const result=summarizeRecoveryAdvice([{kind:'live',reason:'upstream_http_503',
   providerUrl:'https://private.local/?password=hidden',attempts:2}]);
 assert.equal(result.issues.length,1);
 assert.equal(result.issues[0].automaticRetry,false);
 assert.ok(!JSON.stringify(result).includes('password=hidden'));
});
