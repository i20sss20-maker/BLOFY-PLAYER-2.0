// Deterministic, conservative pre-device-test triage. Data comes only from
// registered private PostgreSQL episode snapshots, not the provider catalog.
// This decision NEVER grants content rights, customer availability, app
// compatibility or approval to publish, and it starts no media operations.
const toCount=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
export function evaluatePrivateAppTestGate(
 row={},{
  manifestStateAvailable=false,ownerReviewSchemaAvailable=false
 }={}){
 const registered=toCount(row.registeredEpisodes);
 const verified=toCount(row.storageVerifiedEpisodes);
 const reviewed=toCount(row.ownerAvReviewedEpisodes);
 const failed=toCount(row.failedEpisodes);
 const queued=toCount(row.queuedEpisodes);
 const paused=toCount(row.pausedEpisodes);
 const running=toCount(row.runningEpisodes);
 const inconsistent=toCount(row.inconsistentVerifiedQueueEpisodes);
 const reasons=[];
 if(registered===0)reasons.push('no_registered_episodes');
 if(manifestStateAvailable!==true)reasons.push('manifest_status_unavailable');
 if(ownerReviewSchemaAvailable!==true)reasons.push('owner_av_reviews_unavailable');
 if(failed>0)reasons.push('registered_episode_failures');
 if(queued>0||paused>0||running>0)
  reasons.push('registered_episodes_not_finished');
 if(inconsistent>0)reasons.push('storage_state_inconsistent');
 if(registered>verified)reasons.push('not_all_registered_episodes_storage_verified');
 if(verified>reviewed)reasons.push('owner_av_review_incomplete');
 if(verified>registered||reviewed>verified)
  reasons.push('invalid_database_accounting');
 const canConsiderPrivateDeviceTest=reasons.length===0;
 return {
  status:canConsiderPrivateDeviceTest?
   'candidate_for_private_device_test':'more_checks_required',
  canConsiderPrivateDeviceTest,
  blockingReasons:reasons,
  registeredEpisodes:registered,
  sourceCatalogCoverageKnown:false,
  mediaPlaybackRetestedNow:false,
  independentDeviceCompatibilityVerified:false,
  distributionRightsVerified:false,
  appIntegrationVerified:false,
  customerReleaseApproved:false,
  publishToSubscribers:false,
  automaticCopyStarted:false,
  recommendationScope:'registered_private_episodes_postgres_snapshot_only',
  nextManualChecks:[
   'confirm_distribution_rights_for_each_title',
   'test_private_playback_on_actual_target_devices',
   'check_movie_and_series_navigation_in_apps',
   'review_audio_subtitle_and_seek_behaviour',
   'separate_owner_approval_required_before_any_customer_rollout'
  ]
 };
}
