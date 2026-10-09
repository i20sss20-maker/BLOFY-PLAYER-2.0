import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVED_RC07555, RC07555_PUBLICATION_ACTION, publishApprovedRc07555
} from '../src/approved-release-rc07555.mjs';

const env = {RAILWAY_ENVIRONMENT_NAME:'production'};
const current = {
  id:'11111111-1111-4111-8111-111111111111',
  version_code:2000060,
  version_name:'2.0.0-rc07.49',
  download_url:'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk',
  channel:'testing',
  min_supported_version_code:1
};

function fake({selected=current, target=null, done=false, count=3, initialized=true}={}) {
  const calls=[];let primaryId=selected?.id || null, recorded=[];
  const client={query:async(sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM app_release_selection'))return {rows:[{initialized,primary_id:primaryId}]};
    if(sql.startsWith('SELECT * FROM app_release_catalog WHERE id='))return {rows:selected?[selected]:[]};
    if(sql.startsWith('SELECT 1 FROM app_release_audit'))return {rows:done?[{yes:1}]:[]};
    if(sql.startsWith('SELECT * FROM app_release_catalog WHERE version_code='))return {rows:target?[target]:[]};
    if(sql.startsWith('SELECT COUNT'))return {rows:[{count}]};
    if(sql.startsWith('INSERT INTO app_release_catalog'))return {rows:[{id:args[0],version_code:args[2],version_name:args[3]}]};
    if(sql.startsWith('UPDATE app_release_selection')){primaryId=args[0];return {rows:[]};}
    if(sql.startsWith('INSERT INTO app_release_audit')){recorded.push({action:args[0],releaseId:args[1],details:JSON.parse(args[2])});return {rows:[]};}
    throw new Error('Unexpected SQL '+sql);
  }};
  return {client,calls,get primaryId(){return primaryId;},get recorded(){return recorded;}};
}

test('approved 2000073 exactly matches release metadata and already published APK',()=>{
  assert.equal(APPROVED_RC07555.versionCode,2000073);
  assert.equal(APPROVED_RC07555.versionName,'2.0.0-rc07.55.5');
  assert.equal(APPROVED_RC07555.downloadUrl,'https://updates.blofyplayer.com/files/releases/BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk');
});

test('disabled outside real production',async()=>{
  for(const e of [{},{RAILWAY_ENVIRONMENT_NAME:'staging'},{VERCEL_ENV:'preview'}]){
    const f=fake();assert.equal(await publishApprovedRc07555(f.client,e),'not-production');
    assert.equal(f.calls.length,0);
  }
});

test('only the exact legacy primary migrates; new approval is inserted and audited',async()=>{
  const f=fake();
  assert.equal(await publishApprovedRc07555(f.client,env),'published');
  assert.notEqual(f.primaryId,current.id);
  assert.equal(f.recorded.length,1);
  assert.equal(f.recorded[0].action,RC07555_PUBLICATION_ACTION);
  assert.equal(f.recorded[0].details.versionCode,2000073);
  const insert=f.calls.find(x=>x.sql.startsWith('INSERT INTO app_release_catalog'));
  assert.equal(insert.args[2],2000073);
  assert.equal(insert.args[4],APPROVED_RC07555.downloadUrl);
  assert.equal(f.calls.some(x=>/DELETE|DROP|TRUNCATE/.test(x.sql)),false);
});

test('an already approved primary is a strict no-op',async()=>{
  const f=fake({selected:{...current,version_code:2000073}});
  assert.equal(await publishApprovedRc07555(f.client,env),'already-approved');
  assert.equal(f.calls.some(x=>/^(UPDATE|INSERT)/.test(x.sql)),false);
});

test('administrator-selected newer or modified release is never replaced',async()=>{
  for(const selected of [
    {...current,version_code:2000074,version_name:'2.0.0-rc07.56'},
    {...current,version_code:2000069,version_name:'2.0.0-rc07.55.1'},
    {...current,download_url:'https://example.com/admin-selected.apk'},
    {...current,version_name:'manually-selected'}
  ]){
    const f=fake({selected});
    assert.equal(await publishApprovedRc07555(f.client,env),'selection-changed');
    assert.equal(f.primaryId,selected.id);
    assert.equal(f.calls.some(x=>/^(UPDATE|INSERT)/.test(x.sql)),false);
  }
});

test('does not overwrite a different 2000073 row',async()=>{
  const target={...current,id:'22222222-2222-4222-8222-222222222222',version_code:2000073,version_name:'conflict'};
  const f=fake({target});
  assert.equal(await publishApprovedRc07555(f.client,env),'release-conflict');
  assert.equal(f.primaryId,current.id);
  assert.equal(f.recorded[0].details.outcome,'release-conflict');
  assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE app_release_selection')),false);
});

test('can select an exact existing approved candidate without duplicating',async()=>{
  const target={...current,id:'22222222-2222-4222-8222-222222222222',version_code:2000073,
    version_name:APPROVED_RC07555.versionName,download_url:APPROVED_RC07555.downloadUrl,
    channel:APPROVED_RC07555.channel,min_supported_version_code:1};
  const f=fake({target});
  assert.equal(await publishApprovedRc07555(f.client,env),'published');
  assert.equal(f.primaryId,target.id);
  assert.equal(f.calls.some(x=>x.sql.startsWith('INSERT INTO app_release_catalog')),false);
});

test('audit and capacity guards prevent risky repeated writes',async()=>{
  const done=fake({done:true});
  assert.equal(await publishApprovedRc07555(done.client,env),'already-recorded');
  assert.equal(done.calls.some(x=>/^(UPDATE|INSERT)/.test(x.sql)),false);
  const full=fake({count:200});
  assert.equal(await publishApprovedRc07555(full.client,env),'catalog-full');
  assert.equal(full.primaryId,current.id);
  assert.equal(full.recorded.length,1);
});

test('does nothing for missing or uninitialized selections',async()=>{
  for(const cfg of [{selected:null},{initialized:false}]){
    const f=fake(cfg);
    assert.equal(await publishApprovedRc07555(f.client,env),'no-primary');
    assert.equal(f.calls.some(x=>/^(UPDATE|INSERT)/.test(x.sql)),false);
  }
});
