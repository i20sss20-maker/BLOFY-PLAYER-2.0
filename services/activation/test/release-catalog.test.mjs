import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_RELEASE, ReleaseError, normalizeRelease, initialCatalog, publicCatalog, selectedRelease, changeCatalog, createReleaseCatalog } from '../src/release-catalog.mjs';
const seed = { ...CURRENT_RELEASE, versionCode: 40, versionName: '2.0.40' };
const release = { ...seed, versionCode: 41, versionName: '2.0.41' };
const initial = () => initialCatalog([], seed);
function change(state, action, body) { return changeCatalog(state, action, { revision:state.revision, ...body }); }
function fails(fn, message) { assert.throws(fn, error => error instanceof ReleaseError && error.message === message); }
test('current production selection survives migration; duplicates are deduplicated', () => {
  const state = initialCatalog([{channel:'testing',version_code:35,version_name:'2.0.35',download_url:seed.downloadUrl},
    {channel:'testing',version_code:39,version_name:'bad name',download_url:'http://bad.test'}],seed);
  assert.equal(state.items.length,2);assert.equal(selectedRelease(state).versionCode,40);
  assert.equal(publicCatalog(state).items.filter(x=>x.isPrimary).length,1);
});
test('creating several versions retains previous versions without implicit promotion', () => {
  let state=change(initial(),'create',release);state=change(state,'create',{...release,versionCode:42});
  assert.equal(state.items.length,3);assert.equal(state.primaryVersionCode,40);
});
test('edit targets one immutable version identity and preserves the selection', () => {
  const before=change(initial(),'create',release);
  const after=change(before,'edit',{...release,targetVersionCode:41,releaseNotes:'New note',channel:'stable'});
  assert.equal(after.items.find(x=>x.versionCode===41).releaseNotes,'New note');
  assert.equal(before.items.find(x=>x.versionCode===41).releaseNotes,release.releaseNotes);
  assert.equal(after.primaryVersionCode,40);
  fails(()=>change(before,'edit',{...release,versionCode:42,targetVersionCode:41}),'release_identity_locked');
});
test('select primary atomically changes the public update metadata; previous primary can be removed', () => {
  let state=change(initial(),'create',release);state=change(state,'primary',{targetVersionCode:41});
  assert.equal(selectedRelease(state).versionCode,41);
  assert.equal(publicCatalog(state).items.filter(x=>x.isPrimary).length,1);
  fails(()=>change(state,'delete',{targetVersionCode:41}),'primary_release_protected');
  state=change(state,'delete',{targetVersionCode:40});assert.equal(state.items.length,1);
});
test('stale edits, duplicate version codes and missing versions are rejected', () => {
  fails(()=>changeCatalog(initial(),'create',{...release,revision:0}),'release_conflict');
  fails(()=>change(initial(),'create',seed),'release_exists');
  fails(()=>change(initial(),'delete',{targetVersionCode:999}),'release_not_found');
  fails(()=>change(initial(),'unknown',{targetVersionCode:40}),'invalid_release_action');
});
test('malformed metadata, HTTP, userinfo and executable URLs are rejected', () => {
  for(const value of [{downloadUrl:'http://example.test/app.apk'},{downloadUrl:'javascript:alert(1)'},{downloadUrl:'https://x:y@example.test/app.apk'},
    {versionCode:0},{versionCode:2.5},{versionName:'<img onerror=x>'},{channel:'other'},{minSupportedVersionCode:999}]) {
    fails(()=>normalizeRelease({...seed,...value}),'invalid_release');
  }
});
test('public fields are an explicit allowlist and notes are bounded', () => {
  const value=normalizeRelease({...seed,secret:'do-not-leak',releaseNotes:'\x00'+ 'x'.repeat(700)});
  assert.equal(value.secret,undefined);assert.equal(value.releaseNotes.length,600);
  assert.equal(selectedRelease(initial()).channel,undefined);
});
function mockPool(start=initial()) {
  let state=structuredClone(start);const queries=[];
  const client={release(){queries.push('RELEASE');},async query(sql,args){queries.push(sql);
    if(sql.startsWith('SELECT state'))return {rows:[{state:structuredClone(state)}]};
    if(sql.startsWith('UPDATE blofy'))state=JSON.parse(args[0]);
    return {rows:[]};}};
  return {queries,async connect(){return client;},query:client.query,get state(){return state;}};
}
test('database mutations use one client, a row lock and a transaction', async () => {
  const pool=mockPool();const catalog=createReleaseCatalog({pool,seed});
  await catalog.read();pool.queries.length=0;
  await catalog.mutate('create',{...release,revision:1});
  assert.ok(pool.queries.some(sql=>sql.endsWith('FOR UPDATE')));
  assert.equal(pool.queries[0],'BEGIN');assert.deepEqual(pool.queries.slice(-2),['COMMIT','RELEASE']);
  assert.equal(pool.state.revision,2);
});
test('failed primary deletion rolls back and releases the client', async () => {
  const pool=mockPool();const catalog=createReleaseCatalog({pool,seed});
  await catalog.read();pool.queries.length=0;
  await assert.rejects(catalog.mutate('delete',{revision:1,targetVersionCode:40}),{message:'primary_release_protected'});
  assert.deepEqual(pool.queries.slice(-2),['ROLLBACK','RELEASE']);assert.equal(pool.state.primaryVersionCode,40);
});
test('invalid inputs cannot initialize or touch database storage', async () => {
  const pool=mockPool();const catalog=createReleaseCatalog({pool,seed});
  await assert.rejects(catalog.mutate('create',{...release,downloadUrl:'http://invalid.test'}),{message:'invalid_release'});
  assert.equal(pool.queries.length,0);
});
