import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSafeFailover,safeFailoverAudit} from '../src/restream-safe-failover.mjs';
test('never bypass forbidden or limited provider accounts',()=>{
 for(const reason of ['upstream_http_403','upstream_http_429','upstream_http_456','connection_limit','account_expired']){
  const result=evaluateSafeFailover({primaryFailure:reason,consecutiveFailures:9,
   backupRightsConfirmed:true,backupHealthy:true,operatorApproved:true});
  assert.equal(result.eligible,false);assert.equal(result.reason,'provider_denied');
 }
});
test('requires multiple failures, rights, healthy backup and operator approval',()=>{
 const common={primaryFailure:'media_read_timeout',consecutiveFailures:3};
 assert.equal(evaluateSafeFailover({...common}).reason,'backup_rights_missing');
 assert.equal(evaluateSafeFailover({...common,backupRightsConfirmed:true}).reason,'backup_not_healthy');
 assert.equal(evaluateSafeFailover({...common,backupRightsConfirmed:true,backupHealthy:true}).reason,'operator_approval_required');
 assert.equal(evaluateSafeFailover({...common,backupRightsConfirmed:true,backupHealthy:true,
  operatorApproved:true,currentViewers:1}).reason,'active_sessions_not_migratable');
 const permitted=evaluateSafeFailover({...common,backupRightsConfirmed:true,backupHealthy:true,
  operatorApproved:true,currentViewers:0});
 assert.equal(permitted.eligible,true);assert.equal(permitted.automaticSwitch,false);
});
test('output never includes source URLs or secrets',()=>{
 const summary=safeFailoverAudit(evaluateSafeFailover({primaryFailure:'upstream_http_404'}));
 assert.deepEqual(Object.keys(summary).sort(),['action','automaticSwitch','eligible','reason'].sort());
});
