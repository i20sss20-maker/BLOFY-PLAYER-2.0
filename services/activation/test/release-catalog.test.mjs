import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { createReleaseCatalog, validateRelease, handleReleaseAdmin } from '../src/release-catalog.mjs';
const valid = { channel:'testing', versionName:'2.0.0-rc07.40', versionCode:2000051,
  downloadUrl:'https://example.com/BLOFY-40.apk', releaseNotes:'إصدار التحديث', minSupportedVersionCode:1 };

test('accepts signed APK metadata and preserves Arabic text', () => {
  assert.deepEqual(validateRelease(valid), valid);
  assert.equal(validateRelease({...valid,versionCode:'2000051'}).versionCode,2000051);
});
for (const [name, change] of Object.entries({ http:{downloadUrl:'http://example.com/a.apk'}, script:{downloadUrl:'javascript:alert(1)'},
  credentials:{downloadUrl:'https://a:b@example.com/a.apk'}, fragment:{downloadUrl:'https://example.com/a.apk#secret'},
  nonApk:{downloadUrl:'https://example.com/release'}, invalidVersion:{versionCode:0}, invalidChannel:{channel:'other'},
  forcedBeyondVersion:{minSupportedVersionCode:2000052}, decimalVersion:{versionCode:'20.5'} })) {
  test('rejects '+name,()=>assert.throws(()=>validateRelease({...valid,...change}),/invalid_release/));
}
test('rejects null and arrays without crashing',()=>{for(const body of [null,[],undefined])assert.throws(()=>validateRelease(body),/invalid_release/);});
test('admin authorization runs before catalogue/database access for all mutations',async()=>{
  let reads=0;const catalog={list(){reads++;},mutate(){reads++;}};
  for(const method of ['GET','POST','PATCH','DELETE']){
    let status;
    const res={};const handled=await handleReleaseAdmin(catalog,{method},res,'/api/v1/admin/experience/releases',{
      requireAdmin(){status=401;return false;},json(){throw new Error('must not run');},readJson(){throw new Error('must not run');}});
    assert.equal(handled,true);assert.equal(status,401);
  }assert.equal(reads,0);
});
test('unrelated routes are left untouched',async()=>assert.equal(await handleReleaseAdmin({}, {}, {}, '/api/v1/activation/check', {}),false));

test('PostgreSQL migration, create/edit/delete/primary, rollback and concurrency', { skip: !process.env.BLOFY_TEST_DATABASE_URL }, async t => {
  const schema='release_test_'+crypto.randomUUID().replaceAll('-','');
  const setup=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false});
  await setup.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false,options:`-c search_path=${schema}`,max:8});
  try {
    await pool.query(`CREATE TABLE app_releases(channel TEXT PRIMARY KEY,version_code INTEGER,version_name TEXT,download_url TEXT,release_notes TEXT)`);
    await pool.query("INSERT INTO app_releases VALUES('stable',2000049,'2.0.0-rc07.38','https://example.com/38.apk','قديم')");
    const catalog=createReleaseCatalog(pool,valid);
    await Promise.all([catalog.ensure(),createReleaseCatalog(pool,valid).ensure()]);
    let snapshot=await catalog.list();
    assert.equal(snapshot.items.length,2);const primary40=snapshot.items.find(x=>x.isPrimary);
    assert.equal(primary40.versionCode,2000051);assert.equal((await catalog.primary()).versionCode,2000051);
    await assert.rejects(()=>catalog.mutate('delete',primary40.id,{expectedRevision:primary40.revision}),/primary_release_delete_forbidden/);
    const next={...valid,versionCode:2000052,versionName:'2.0.0-rc07.41',downloadUrl:'https://example.com/41.apk'};
    const created=await catalog.mutate('create',null,next);
    assert.equal((await catalog.primary()).versionCode,2000051,'create is not publish');
    await assert.rejects(()=>catalog.mutate('create',null,next),/release_version_exists/);
    const candidate=(await catalog.list()).items.find(x=>x.id===created.id);
    await catalog.mutate('update',candidate.id,{...next,expectedRevision:1,releaseNotes:'تعديل عربي ✓'});
    await assert.rejects(()=>catalog.mutate('update',candidate.id,{...next,expectedRevision:1}),/release_changed/);
    snapshot=await catalog.list();
    await catalog.mutate('primary',candidate.id,{expectedRevision:2,expectedSelectionRevision:snapshot.selectionRevision});
    assert.equal((await catalog.primary()).versionCode,2000052);
    assert.equal((await catalog.primary()).releaseNotes,'تعديل عربي ✓');
    await assert.rejects(()=>catalog.mutate('delete',candidate.id,{expectedRevision:2}),/primary_release_delete_forbidden/);
    // Two admins acting on the same selection revision: exactly one succeeds.
    snapshot=await catalog.list();const other=snapshot.items.find(x=>x.versionCode===2000049);
    const outcomes=await Promise.allSettled([primary40,other].map(x=>catalog.mutate('primary',x.id,{expectedRevision:x.revision,expectedSelectionRevision:snapshot.selectionRevision})));
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    snapshot=await catalog.list();assert.equal(snapshot.items.filter(x=>x.isPrimary).length,1);
    // Make 40 primary again before deleting 41; cold starts must not resurrect deleted versions.
    await catalog.mutate('primary',primary40.id,{expectedRevision:primary40.revision,expectedSelectionRevision:snapshot.selectionRevision});
    await catalog.mutate('delete',candidate.id,{expectedRevision:2});
    const restarted=createReleaseCatalog(pool,valid);await restarted.ensure();
    assert.equal((await restarted.list()).items.some(x=>x.id===candidate.id),false);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM app_releases')).rows[0].n,1,'legacy rows untouched');
    assert.ok((await pool.query('SELECT COUNT(*)::int n FROM app_release_audit')).rows[0].n>=5);
  } finally {await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
});
