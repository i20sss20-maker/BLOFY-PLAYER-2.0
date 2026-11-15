import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMirrorStorageAttestation,attestMirrorStorageRights}
 from '../src/xtream-mirror-rights-attestation.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';
const allowed={
 sourceId,mediaKind:'movie',gatewayId:123,mediaId:'film_777',
 extension:'mp4',evidenceReference:'grant:film:contract-2026-11',
 storagePermitted:true,persistentStorageScope:'saleh-vod-persistent-copy',
 operatorReviewed:true
};

test('a single exact rights attestation is hashed and requires operator review',async()=>{
 const args=[];
 const db={query:async(sql,values)=>{
  args.push({sql,values});return {rowCount:1};
 }};
 const result=await attestMirrorStorageRights(db,allowed);
 assert.equal(result.ok,true);
 assert.equal(result.readyForCopy,false);
 assert.equal(result.sizeProbed,false);
 assert.equal(result.mediaBytesTransferred,0);
 assert.equal(args.length,1);
 assert.match(args[0].sql,/mapping_conflict=FALSE/);
 assert.match(args[0].sql,/m\.source_id=q\.media_id/);
 assert.match(args[0].sql,/last_sync_at>NOW\(\)-INTERVAL/);
 assert.equal(args[0].values[0],sourceId);
 assert.match(args[0].values[5],/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(args).includes(allowed.evidenceReference),false);
});

test('a manually claimed Xtream account is not blanket legal grant',async()=>{
 for(const patch of [
  {storagePermitted:false},{operatorReviewed:false},
  {persistentStorageScope:'restream'}, {evidenceReference:'short'},
  {mediaKind:'live'},{sourceId:'bad'}, {mediaId:'../invalid'},
  {gatewayId:0}
 ])assert.throws(()=>validateMirrorStorageAttestation({
  ...allowed,...patch}),/mirror_rights_review_invalid/);
});

test('stale, remapped, missing or previously verified candidate cannot be attested',async()=>{
 const db={query:async()=>({rowCount:0})};
 const result=await attestMirrorStorageRights(db,allowed);
 assert.equal(result.ok,false);
 assert.equal(result.code,'mirror_rights_candidate_not_eligible');
 assert.equal(result.copyStarted,false);
});

test('episode permission is scoped to mapped episode identity, not whole series',async()=>{
 let sql;
 await attestMirrorStorageRights({query:async(q)=>{
  sql=q;return {rowCount:1};
 }},{...allowed,mediaKind:'episode',gatewayId:456,
  evidenceReference:'grant:episode:contract-2026-11'});
 assert.match(sql,/e\.source_episode_id=q\.media_id/);
 assert.match(sql,/e\.container_extension/);
 assert.match(sql,/i\.enabled=TRUE/);
});
