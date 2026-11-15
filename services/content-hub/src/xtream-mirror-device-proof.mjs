// Private Content Hub proof gate before minting a short-lived owner-device
// ticket. Reconcile a verified PG/S3 mirror and require a recent private
// video+audio+4-seek canary. Does not prove actual on-device playback.
export function validateMirrorDeviceTicketProof({
 selected,lastQa,now=Date.now(),maxAgeMs=30*60*1000
}={}){
 const invalid=code=>({
  ok:false,code,devicePlaybackValidated:false,
  customerCutover:false,providerRequests:0
 });
 if(!selected?.ok||!/^mirror_[a-f0-9]{40}$/.test(selected.runId||'')||
    !/^[a-f0-9]{64}$/.test(selected.sha256||'')||
    !['movie','episode'].includes(selected.mediaKind)||
    !Number.isSafeInteger(selected.bytes)||selected.bytes<8388608)
  return invalid('mirror_device_verified_media_missing');
 const checked=Date.parse(lastQa?.checkedAt||'');
 if(lastQa?.ok!==true||
    lastQa?.code!=='canary_audio_video_and_seeks_verified'||
    lastQa?.seeksVerified!==4||
    lastQa?.runId!==selected.runId||
    lastQa?.sha256!==selected.sha256||
    !Number.isFinite(checked)||!Number.isFinite(now)||
    now<checked-15000||now-checked>maxAgeMs)
  return invalid('mirror_device_recent_av_seek_proof_missing');
 return {ok:true,code:'mirror_device_ticket_proof_ready',
  mediaKind:selected.mediaKind,runId:selected.runId,
  bytes:selected.bytes,privateOnly:true,
  devicePlaybackValidated:false,releaseToSubscribersApproved:false,
  customerCutover:false,providerRequests:0};
}
