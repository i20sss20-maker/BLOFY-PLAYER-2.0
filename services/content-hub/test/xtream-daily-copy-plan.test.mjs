import test from 'node:test';
import assert from 'node:assert/strict';
import {planDailyLicensedXtreamCopies} from '../src/xtream-daily-copy-plan.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';
const licenseEvidence={storagePermitted:true,scope:'saleh-vod-persistent-copy'};
const env={
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'
};
const privateBucket={private:true,configured:true};
const movie=(id,size=1024*1024*16,override={})=>({
 mediaKind:'movie',mediaId:id,sourceId,expectedBytes:size,
 extension:'mp4',version:'etag-v1',licenseEvidence,...override
});

test('licensed VOD may be proposed but planner cannot start media upload',()=>{
 const report=planDailyLicensedXtreamCopies({
  catalog:[movie('first'),movie('second')],
  env,privateBucket,maxFiles:1
 });
 assert.equal(report.proposed.length,1);
 assert.equal(report.proposed[0].mediaId,'first');
 assert.equal(report.dryRun,true);
 assert.equal(report.uploadsStarted,0);
 assert.equal(report.bytesTransferred,0);
 assert.equal(report.deletionScheduled,false);
 assert.equal(report.blocked.daily_transfer_budget_reached,1);
});

test('never treats source account access as individual storage permission',()=>{
 const report=planDailyLicensedXtreamCopies({
  catalog:[movie('no_grant',undefined,{licenseEvidence:undefined})],
  env,privateBucket
 });
 assert.equal(report.proposed.length,0);
 assert.equal(report.blocked.individual_storage_license_missing,1);
});

test('verified unchanged copy is kept, changed revision needs human review',()=>{
 const old={mediaKind:'movie',mediaId:'ok',sourceId,
  version:'etag-v1',expectedBytes:16*1024*1024,verified:true};
 const a=planDailyLicensedXtreamCopies({
  catalog:[movie('ok')],verifiedCopies:[old],env,privateBucket
 });
 assert.equal(a.alreadyVerified,1);
 assert.equal(a.proposed.length,0);
 const b=planDailyLicensedXtreamCopies({
  catalog:[movie('ok',16*1024*1024,{version:'etag-v2'})],
  verifiedCopies:[old],env,privateBucket
 });
 assert.equal(b.proposed.length,0);
 assert.equal(b.blocked.stored_copy_requires_revision_review,1);
});

test('live channels and series are metadata-only, no live recording',()=>{
 const report=planDailyLicensedXtreamCopies({
  catalog:[{mediaKind:'live'}, {mediaKind:'series'}],env,privateBucket
 });
 assert.equal(report.metadataOnly,2);
 assert.equal(report.proposed.length,0);
});

test('unknown sizes, duplicate items and missing upload opt-in fail closed',()=>{
 const report=planDailyLicensedXtreamCopies({
  catalog:[movie('x',null),movie('dup'),movie('dup')],env:{},privateBucket
 });
 assert.equal(report.proposed.length,0);
 assert.equal(report.blocked.size_requires_verified_probe_or_unsupported,1);
 assert.equal(report.blocked.duplicate_catalog_item,1);
 assert.equal(report.blocked.upload_feature_disabled,1);
});
