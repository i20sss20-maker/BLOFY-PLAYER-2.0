import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';
const token='X'.repeat(40);
async function withServer(env,fn){
 const hub=createContentHubServer({
   token,pilotEnv:env,
   storage:{health:async()=>({ok:true})},
   lease:{health:async()=>true}
 });
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{
   const url='http://127.0.0.1:'+hub.server.address().port+
     '/internal/mirror/daily/plan';
   await fn(url);
 }finally{
   await new Promise(resolve=>hub.server.close(resolve));
 }
}
const sample={catalog:[{mediaKind:'movie',sourceId,mediaId:'film11',
 extension:'mp4',expectedBytes:16777216,
 licenseEvidence:{storagePermitted:true,scope:'saleh-vod-persistent-copy'}}]};
const licensed={
 BLOFY_CONTENT_HUB_DAILY_MIRROR_PLANNER_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'
};
const post=(url,body,headers={})=>fetch(url,{method:'POST',
 headers:{authorization:'Bearer '+token,
  'content-type':'application/json',
  'x-blofy-owner-action':'preview-licensed-daily-mirror',...headers},
 body:JSON.stringify(body)});

test('operator dry-run previews licensed movie without downloading bytes',async()=>{
 await withServer(licensed,async url=>{
  const r=await post(url,sample),j=await r.json();
  assert.equal(r.status,200);
  assert.equal(j.proposed.length,1);
  assert.equal(j.dryRun,true);
  assert.equal(j.uploadsStarted,0);
  assert.equal(j.physicalCopyCoverageUnknown,true);
  assert.equal(j.customerCutover,false);
 });
});

test('preview rejects missing operator secret, missing rights and disabled feature',async()=>{
 await withServer(licensed,async url=>{
  const wrong=await post(url,sample,{'x-blofy-owner-action':'other'});
  assert.equal(wrong.status,403);
  const unlicensed=await post(url,{catalog:[{
    ...sample.catalog[0],licenseEvidence:undefined
  }]});
  const j=await unlicensed.json();
  assert.equal(j.proposed.length,0);
  assert.equal(j.blocked.individual_storage_license_missing,1);
  const auth=await fetch(url,{method:'POST',headers:{
    'content-type':'application/json',
    'x-blofy-owner-action':'preview-licensed-daily-mirror'
  },body:JSON.stringify(sample)});
  assert.equal(auth.status,401);
 });
 await withServer({},async url=>{
  const r=await post(url,sample);
  assert.equal(r.status,409);
 });
});

test('cannot declare arbitrary stored copies already verified via client JSON',async()=>{
 await withServer(licensed,async url=>{
  const r=await post(url,{...sample,verifiedCopies:[
    {mediaKind:'movie',mediaId:'film11',sourceId,verified:true}
  ]});
  assert.equal(r.status,400);
 });
});
