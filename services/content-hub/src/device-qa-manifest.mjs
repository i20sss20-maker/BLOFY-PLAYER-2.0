// BLOFY owner-only device QA plan contract v1.
// Never contains stream/playlist/token/source URLs, media credentials,
// approval to publish, or instructions to bypass the owner-only media bridge.
const DEVICES=new Map([
 ['android',{
  label:'Android mobile',
  checks:['app_navigation','portrait_landscape','start_playback',
   'audio_output','seek_and_resume','subtitle_selection','network_recovery']
 }],
 ['android_tv',{
  label:'Android TV',
  checks:['remote_dpad_navigation','focus_visibility','video_start',
   'audio_output','seek_with_remote','subtitle_selection',
   'exit_back_button','network_recovery']
 }],
 ['windows',{
  label:'Windows desktop',
  checks:['mouse_keyboard_navigation','video_start','audio_output',
   'seek_and_resume','subtitle_selection','window_resize','network_recovery']
 }]
]);
const SEASON=/^series_[1-9][0-9]{0,14}_s[0-9]{1,3}$/;
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
export const deviceQaPlatforms=()=>[...DEVICES.keys()];
export function validateDeviceQaSelection({platform,seasonKey,page}={}){
 if(!DEVICES.has(platform)||!SEASON.test(String(seasonKey||''))||
    !Number.isSafeInteger(page)||page<1||page>20000)
  throw Error('private_device_qa_selection_invalid');
 return {platform,seasonKey,page};
}
export function buildPrivateDeviceQaManifest({
 platform,seasonKey,page=1,detail
}={}){
 validateDeviceQaSelection({platform,seasonKey,page});
 if(!detail||detail.page?.number!==page||
    detail.page?.seasonKey!==seasonKey||
    !Array.isArray(detail.episodes)||detail.episodes.length>50)
  throw Error('private_device_qa_snapshot_invalid');
 const checks=DEVICES.get(platform);
 const rows=detail.episodes.map(row=>{
  const valid=RUN.test(String(row.runId||''))&&
   Number.isInteger(Number(row.episodeNumber))&&
   Number(row.episodeNumber)>=1&&Number(row.episodeNumber)<=500;
  if(!valid)throw Error('private_device_qa_episode_invalid');
  const storageVerified=row.verified===true&&row.state==='verified';
  const manuallyReviewed=storageVerified&&
   Boolean(row.ownerAvConfirmedAt);
  const blockers=[];
  if(!storageVerified)blockers.push('storage_proof_not_verified');
  if(storageVerified&&!manuallyReviewed)blockers.push('human_audio_video_review_missing');
  // A transfer checkpoint is not playback verification.
  const bytes=Math.max(0,Number(row.expectedBytes)||0);
  return {
   runId:row.runId,
   episodeNumber:Number(row.episodeNumber),
   title:String(row.title||'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160),
   registeredQueueState:row.state,
   storageVerified,manualAudioVideoReviewed:manuallyReviewed,
   reviewTimestamp:manuallyReviewed?row.ownerAvConfirmedAt:null,
   expectedBytes:bytes,
   candidateForOwnerDeviceTesting:blockers.length===0,
   blockers,
   checkIds:[...checks.checks],
   perDeviceTestResults:'not_recorded',
   devicePlaybackVerified:false,
   distributionRightsVerified:false,
   releaseToSubscribersApproved:false
  };
 });
 const candidates=rows.filter(x=>x.candidateForOwnerDeviceTesting).length;
 return {
  schema:'blofy.private-device-qa-manifest',
  version:1,
  ok:true,privateOnly:true,readOnly:true,
  platform,platformLabel:checks.label,seasonKey,page,
  perPage:50,registeredEpisodesInSeason:Number(detail.totals?.episode_count)||0,
  pageCount:Number(detail.page.pages)||1,
  hasNextPage:detail.page.hasNext===true,
  totalShown:rows.length,candidateCount:candidates,
  blockedCount:rows.length-candidates,
  episodes:rows,
  scope:'registered_private_queue_episode_page_only',
  customerCutover:false,automaticStart:false,publicApi:false,
  playableMediaUrlsIncluded:false,credentialsIncluded:false,
  allSourceEpisodesCountKnown:false,devicePlaybackValidated:false,
  appIntegrationCompleted:false,distributionRightsVerified:false,
  releaseToSubscribersApproved:false,
  manualTestRequired:true,
  manualTestChecks:[...checks.checks],
  instructions:'Owner-only QA worksheet. Review rights and test actual device players separately. Never use as an app subscriber playlist or publication approval.'
 };
}
