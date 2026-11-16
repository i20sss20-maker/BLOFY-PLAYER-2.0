import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessMirrorPreflight,probeStagedMirrorSource,
 recordMirrorPreflight} from '../src/xtream-mirror-transfer-preflight.mjs';

const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const ID='135791';
const KIND='movie';
const BYTES=8*1024*1024;
const SOURCE_ROW={id:SOURCE,name:'saleh',enabled:true,
 publish_catalog:true,base_url:'https://source.example/media/'};
const ITEM={mediaId:ID,extension:'mkv'};
const PROOF={ok:true,probeBytes:4096,expectedBytes:BYTES,
 validatorPresent:true,extension:'mkv'};
const LICENSE='saleh-vod-storage-2026';
const now=Date.now();
const CAPACITY={verifiedPrivateBucket:true,usageExact:true,
 observedAt:now,budgetBytes:2*1024**3,usedBytes:200*1024**2,
 reservedBytes:100*1024**2};

test('source preflight reads exactly one 4KiB range without S3 or copy',async()=>{
 const calls=[];
 const result=await probeStagedMirrorSource({
  source:SOURCE_ROW,kind:KIND,item:ITEM,
  credentials:{username:'demo_user',password:'secret_pass'},
  validateOrigin:async origin=>assert.equal(origin,'https://source.example'),
  fetchImpl:async(url,opts)=>{
   calls.push({url,opts});
   return new Response(Buffer.alloc(4096),{status:206,
    headers:{'content-range':'bytes 0-4095/'+BYTES,
     'content-length':'4096','etag':'"immutable-version-1"'}});
  }
 });
 assert.equal(result.ok,true);
 assert.equal(result.expectedBytes,BYTES);
 assert.equal(result.probeBytes,4096);
 assert.equal(result.validatorPresent,true);
 assert.equal(result.mediaBytesTransferred,0);
 assert.equal(result.copyWorkerEnabled,false);
 assert.equal(result.customerCutover,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.method,'GET');
 assert.equal(calls[0].opts.redirect,'manual');
 assert.equal(calls[0].opts.headers.range,'bytes=0-4095');
 assert.equal(calls[0].url,'https://source.example/media/movie/demo_user/secret_pass/135791.mkv');
 assert.ok(!JSON.stringify(result).includes('secret_pass'));
 assert.ok(!JSON.stringify(result).includes('source.example'));
});

test('source rejects unapproved source and unknown extension before fetch',async()=>{
 let calls=0;
 const bad=await probeStagedMirrorSource({source:{...SOURCE_ROW,name:'other'},
  kind:KIND,item:ITEM,credentials:{username:'a',password:'b'},
  validateOrigin:async()=>{},fetchImpl:async()=>{calls++}});
 const wrongExt=await probeStagedMirrorSource({source:SOURCE_ROW,
  kind:KIND,item:{mediaId:ID,extension:'exe'},
  credentials:{username:'a',password:'b'},
  validateOrigin:async()=>{},fetchImpl:async()=>{calls++}});
 assert.equal(bad.ok,false);assert.equal(wrongExt.ok,false);
 assert.equal(calls,0);
});

test('200/full-GET fallback, invalid range and missing source must fail closed',async()=>{
 let calls=0;
 const result=await probeStagedMirrorSource({source:SOURCE_ROW,kind:KIND,
  item:ITEM,credentials:{username:'demo',password:'secret'},
  validateOrigin:async()=>{},fetchImpl:async()=>{
   calls++;return new Response(Buffer.alloc(4096),{status:200})
  }});
 assert.equal(result.ok,false);
 assert.equal(result.providerMediaRequests,1);
 assert.equal(calls,1);
 assert.equal(result.copyWorkerEnabled,false);
});

test('size alone cannot authorize storage without per-item license and fresh bucket accounting',()=>{
 const noEvidence=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:PROOF,capacity:CAPACITY,now});
 assert.equal(noEvidence.ok,false);
 assert.ok(noEvidence.blockedBy.includes('item_storage_license_evidence_missing'));
 const noCapacity=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:PROOF,licenseReference:LICENSE,now});
 assert.equal(noCapacity.ok,false);
 assert.ok(noCapacity.blockedBy.includes('private_storage_capacity_unverified'));
 const stale=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:PROOF,licenseReference:LICENSE,
  capacity:{...CAPACITY,observedAt:now-3600000},now});
 assert.equal(stale.ok,false);
 assert.ok(stale.blockedBy.includes('private_storage_capacity_unverified'));
});

test('budget reservation and immutable source validator gate eligibility',()=>{
 const good=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:PROOF,licenseReference:LICENSE,capacity:CAPACITY,now});
 assert.equal(good.ok,true);
 assert.equal(good.transferReady,false);
 assert.equal(good.workerReviewed,false);
 assert.equal(good.mediaBytesTransferred,0);
 const out=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:PROOF,licenseReference:LICENSE,now,
  capacity:{...CAPACITY,budgetBytes:300*1024**2}});
 assert.equal(out.ok,false);
 assert.ok(out.blockedBy.includes('private_storage_budget_exceeded'));
 const unversioned=assessMirrorPreflight({sourceId:SOURCE,kind:KIND,id:ID,
  probe:{...PROOF,validatorPresent:false},
  licenseReference:LICENSE,capacity:CAPACITY,now});
 assert.equal(unversioned.ok,false);
 assert.ok(unversioned.blockedBy.includes('source_version_validator_missing'));
});

function dbFixture({staged=true}={}){
 const calls=[],db={
  query:async(sql,args)=>{
   calls.push({sql,args});
   if(sql.startsWith('CREATE TABLE'))return {rowCount:0,rows:[]};
   throw Error('unexpected pool SQL');
  },
  connect:async()=>({
   query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('SELECT extension FROM blofy_stream_mirror_intents'))
     return {rowCount:staged?1:0,rows:staged?[{extension:'mkv'}]:[]};
    if(sql.includes('SUM(expected_bytes)'))
     return {rows:[{total:'0'}]};
    if(sql.startsWith('INSERT INTO blofy_stream_mirror_preflights'))
     return {rowCount:1,rows:[]};
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||
       sql.startsWith('SET LOCAL')||
       sql.includes('pg_advisory_xact_lock'))
     return {rowCount:1,rows:[]};
    throw Error('unexpected transaction SQL');
   },
   release:()=>calls.push({sql:'RELEASE'})
  })
 };
 return {db,calls};
}

test('one item stores measured proof durably while no capacity report exists',async()=>{
 const f=dbFixture();
 const saved=await recordMirrorPreflight(f.db,{sourceId:SOURCE,
  kind:KIND,id:ID,probe:PROOF,licenseReference:LICENSE,
  ownerConfirmed:true,capacity:null,now});
 assert.equal(saved.ok,true);
 assert.equal(saved.state,'measured');
 assert.equal(saved.expectedBytes,BYTES);
 assert.equal(saved.copyWorkerEnabled,false);
 assert.equal(saved.mediaBytesTransferred,0);
 assert.equal(saved.customerCutover,false);
 assert.ok(saved.blockedBy.includes('private_storage_capacity_unverified'));
 assert.ok(f.calls.some(c=>c.sql==='COMMIT'));
 const write=f.calls.find(c=>c.sql.startsWith('INSERT INTO blofy_stream_mirror_preflights'));
 assert.equal(write.args[3],BYTES);
 assert.equal(write.args[6],'measured');
 assert.equal(write.args[5].length,64);
 assert.ok(!JSON.stringify(f.calls).includes(LICENSE));
});

test('cancellation or stale intake prevents a measured record',async()=>{
 const f=dbFixture({staged:false});
 const r=await recordMirrorPreflight(f.db,{sourceId:SOURCE,kind:KIND,
  id:ID,probe:PROOF,ownerConfirmed:true});
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_preflight_intake_changed');
 assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));
 assert.ok(!f.calls.some(c=>c.sql.startsWith('INSERT INTO')));
});

test('invalid source proof cannot modify database',async()=>{
 const f=dbFixture();
 for(const p of [{...PROOF,probeBytes:8192},
  {...PROOF,expectedBytes:5*1024**3}])
  assert.equal((await recordMirrorPreflight(f.db,{sourceId:SOURCE,
   kind:KIND,id:ID,probe:p,ownerConfirmed:true})).ok,false);
 assert.equal(f.calls.length,0);
});

test('Portal source probe is opt-in and never accepts an operator capacity estimate',async()=>{
 const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.ok(src.includes("p==='/internal/blofy-stream/ops/mirror-intake/preflight'"));
 assert.ok(src.includes("BLOFY_STREAM_MIRROR_PREFLIGHT_ENABLED!=='1'"));
 assert.ok(src.includes("req.headers['x-blofy-owner-action']!=='probe-private-mirror-intake'"));
 assert.ok(src.includes('mirrorPreflightRunning'));
 assert.ok(src.includes('capacity:null,ownerConfirmed:true'));
 assert.ok(src.includes('probeStagedMirrorSource'));
});
