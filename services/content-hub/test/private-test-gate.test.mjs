import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePrivateAppTestGate} from '../src/private-test-gate.mjs';

const ready={registeredEpisodes:4,storageVerifiedEpisodes:4,
 ownerAvReviewedEpisodes:4,failedEpisodes:0,queuedEpisodes:0,
 pausedEpisodes:0,runningEpisodes:0,inconsistentVerifiedQueueEpisodes:0};
const flags={manifestStateAvailable:true,ownerReviewSchemaAvailable:true};
test('fully reviewed registered episodes are only a private device-test candidate',()=>{
 const result=evaluatePrivateAppTestGate(ready,flags);
 assert.equal(result.canConsiderPrivateDeviceTest,true);
 assert.equal(result.status,'candidate_for_private_device_test');
 assert.deepEqual(result.blockingReasons,[]);
 assert.equal(result.sourceCatalogCoverageKnown,false);
 assert.equal(result.distributionRightsVerified,false);
 assert.equal(result.mediaPlaybackRetestedNow,false);
 assert.equal(result.independentDeviceCompatibilityVerified,false);
 assert.equal(result.appIntegrationVerified,false);
 assert.equal(result.customerReleaseApproved,false);
 assert.equal(result.publishToSubscribers,false);
 assert.equal(result.automaticCopyStarted,false);
 assert.ok(result.nextManualChecks.some(x=>x.includes('distribution_rights')));
});
test('no registered episode and absent proof schemas fail closed',()=>{
 const empty=evaluatePrivateAppTestGate({},flags);
 assert.equal(empty.canConsiderPrivateDeviceTest,false);
 assert.deepEqual(empty.blockingReasons,['no_registered_episodes']);
 const missing=evaluatePrivateAppTestGate(ready,{manifestStateAvailable:false,
  ownerReviewSchemaAvailable:false});
 assert.equal(missing.canConsiderPrivateDeviceTest,false);
 assert.ok(missing.blockingReasons.includes('manifest_status_unavailable'));
 assert.ok(missing.blockingReasons.includes('owner_av_reviews_unavailable'));
});
test('partial, failed, queued or unreviewed registered content cannot be a candidate',()=>{
 const cases=[
  [{failedEpisodes:1},'registered_episode_failures'],
  [{queuedEpisodes:1},'registered_episodes_not_finished'],
  [{pausedEpisodes:1},'registered_episodes_not_finished'],
  [{runningEpisodes:1},'registered_episodes_not_finished'],
  [{inconsistentVerifiedQueueEpisodes:1},'storage_state_inconsistent'],
  [{storageVerifiedEpisodes:3},'not_all_registered_episodes_storage_verified'],
  [{ownerAvReviewedEpisodes:2},'owner_av_review_incomplete'],
  [{ownerAvReviewedEpisodes:5},'invalid_database_accounting'],
  [{storageVerifiedEpisodes:5},'invalid_database_accounting']
 ];
 for(const [changes,reason] of cases){
  const result=evaluatePrivateAppTestGate({...ready,...changes},flags);
  assert.equal(result.canConsiderPrivateDeviceTest,false,reason);
  assert.ok(result.blockingReasons.includes(reason),reason);
  assert.equal(result.customerReleaseApproved,false);
 }
});
test('numeric values are bounded, no input mutation and no automatic customer approval',()=>{
 const input={...ready,registeredEpisodes:'4',
  storageVerifiedEpisodes:'4',ownerAvReviewedEpisodes:'4'};
 const before=JSON.stringify(input);
 const result=evaluatePrivateAppTestGate(input,flags);
 assert.equal(JSON.stringify(input),before);
 assert.equal(result.canConsiderPrivateDeviceTest,true);
 assert.equal(result.registeredEpisodes,4);
 assert.equal(result.publishToSubscribers,false);
});
