// Offline reconciliation for a PRIVATE, licensed daily Xtream VOD mirror.
// Never fetches provider media. Live channels are continuous streams; their
// catalog is refreshed by xtream-daily-catalog-sync, NOT stored as VOD files.
import {authorizeMirrorJob} from './mirror-policy.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_FILE=4*1024**3; // current verified chunk runner limit
const keyFor=x=>[x.mediaKind,x.sourceId,x.mediaId].join(':');

export function planDailyLicensedXtreamCopies({
 catalog=[],verifiedCopies=[],env={},privateBucket,
 maxFiles=12,maxBytes=12*1024**3,activeUpstreamFeeds=0
}={}){
 if(!Array.isArray(catalog)||!Array.isArray(verifiedCopies)||
    catalog.length>500000||verifiedCopies.length>500000||
    !Number.isInteger(maxFiles)||maxFiles<1||maxFiles>12||
    !Number.isSafeInteger(maxBytes)||maxBytes<8*1024*1024||
    maxBytes>64*1024**3)
   throw Error('daily_copy_plan_bounds_invalid');
 const previous=new Map();
 for(const p of verifiedCopies){
  if(!['movie','episode'].includes(p?.mediaKind)||!UUID.test(p?.sourceId)||
     !ID.test(p?.mediaId))continue;
  if(p.verified===true)previous.set(keyFor(p),p);
 }
 const seen=new Set(),queue=[],blocked={},unchanged=0;
 let bytes=0,metaOnly=0;
 const block=code=>{blocked[code]=(blocked[code]||0)+1};
 for(const item of catalog){
  if(item?.mediaKind==='live'||item?.mediaKind==='series'){
   metaOnly++;continue;
  }
  if(!['movie','episode'].includes(item?.mediaKind)||
    !UUID.test(item?.sourceId)||!ID.test(item?.mediaId)){
   block('invalid_catalog_item');continue;
  }
  const key=keyFor(item);
  if(seen.has(key)){block('duplicate_catalog_item');continue}
  seen.add(key);
  // Never silently delete stored objects that disappear from a provider feed.
  const old=previous.get(key);
  if(old){
   if(old.version&&item.version&&old.version===item.version&&
      Number(old.expectedBytes)===Number(item.expectedBytes)){
    unchanged++;continue;
   }
   block('stored_copy_requires_revision_review');continue;
  }
  const expectedBytes=Number(item.expectedBytes);
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<8192||
     expectedBytes>MAX_FILE){
   block('size_requires_verified_probe_or_unsupported');continue;
  }
  if(!['mp4','mkv','ts','avi'].includes(item.extension)){
   block('format_not_supported');continue;
  }
  const proof=authorizeMirrorJob({
   env,sourceName:'saleh',sourceId:item.sourceId,
   mediaKind:item.mediaKind,mediaId:item.mediaId,
   extension:item.extension,expectedBytes,
   licenseEvidence:item.licenseEvidence,privateBucket,activeUpstreamFeeds
  });
  if(!proof.allowed){for(const code of proof.codes)block(code);continue}
  if(queue.length>=maxFiles || expectedBytes>maxBytes-bytes){
   block('daily_transfer_budget_reached');continue;
  }
  // Stored in a PLAN only; an independent operator/policy-approved worker
  // must claim an exact item, re-probe size/version and verify private SHA.
  queue.push({mediaKind:item.mediaKind,sourceId:item.sourceId,
   mediaId:item.mediaId,extension:item.extension,expectedBytes,
   sourceVersion:item.version||null,requiresSourceRecheck:true,
   customerCutover:false});
  bytes+=expectedBytes;
 }
 return {
  dryRun:true,uploadsStarted:0,bytesTransferred:0,customerCutover:false,
  proposed:queue,proposedBytes:bytes,alreadyVerified:unchanged,
  metadataOnly:metaOnly,blocked,retainedStoredCopies:previous.size,
  deletionScheduled:false,
  notes:'No media copied; provider quota, scoped rights, verified size and storage capacity required before worker dispatch.'
 };
}
