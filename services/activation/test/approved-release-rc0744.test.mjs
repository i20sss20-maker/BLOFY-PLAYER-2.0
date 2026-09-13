import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { APPROVED_RC0744 as release, RC0744_PUBLICATION_ACTION as action, publishApprovedRc0744 as publish } from '../src/approved-release-rc0744.mjs';

const previous = { id:'11111111-1111-4111-8111-111111111111', channel:'testing', version_code:2000053,
  version_name:'2.0.0-rc07.42', min_supported_version_code:1,
  download_url:'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.42/BLOFY-PLAYER-2.0-rc07.42-signed.apk' };
function fake({ current=previous, target=null, done=false, count=2 }={}) {
  const calls=[]; let audit=null; let primary=current?.id;
  const client={query:async (sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM app_release_selection'))return {rows:[{primary_id:current?.id}]};
    if(sql.startsWith('SELECT 1 FROM app_release_audit'))return {rows:done?[{exists:1}]:[]};
    if(sql.startsWith('SELECT * FROM app_release_catalog WHERE id='))return {rows:current?[current]:[]};
    if(sql.startsWith('SELECT * FROM app_release_catalog WHERE version_code='))return {rows:target?[target]:[]};
    if(sql.startsWith('SELECT COUNT'))return {rows:[{count}]};
    if(sql.startsWith('INSERT INTO app_release_catalog'))return {rows:[{id:args[0]}]};
    if(sql.startsWith('UPDATE app_release_selection')){primary=args[0];return {rows:[]};}
    if(sql.startsWith('INSERT INTO app_release_audit')){audit={action:args[0],releaseId:args[1],details:JSON.parse(args[2])};return {rows:[]};}
    throw new Error('Unexpected SQL: '+sql);
  }};
  return {client,calls,get audit(){return audit;},get primary(){return primary;}};
}
test('publication is absent from preview, development and ordinary local tests',async()=>{
  for(const env of ['preview','development',undefined]){const f=fake();assert.equal(await publish(f.client,env),'not-production');assert.equal(f.calls.length,0);}
});
test('one approved publication preserves the previous row and is optional',async()=>{
  const f=fake();assert.equal(await publish(f.client,'production'),'published');
  assert.notEqual(f.primary,previous.id);assert.equal(f.audit.action,action);assert.equal(f.audit.details.sha256,release.sha256);
  const insert=f.calls.find(x=>x.sql.startsWith('INSERT INTO app_release_catalog'));
  assert.equal(insert.args[2],2000055);assert.equal(insert.args[6],1);
  assert.equal(f.calls.some(x=>/^DELETE|DROP/.test(x.sql)),false);
});
test('a recorded publication never changes a later administrator selection',async()=>{
  const f=fake({done:true});assert.equal(await publish(f.client,'production'),'already-recorded');
  assert.equal(f.calls.some(x=>/^UPDATE|INSERT|DELETE/.test(x.sql)),false);
});
test('changed, missing or newer primary is recorded without overwriting it',async()=>{
  for(const current of [null,{...previous,version_code:2000056},{...previous,download_url:'https://example.invalid/other.apk'}]){
    const f=fake({current});assert.equal(await publish(f.client,'production'),'skipped-selection-changed');
    assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE app_release_selection')),false);
  }
});
test('a conflicting version-55 row is not silently rewritten or published',async()=>{
  const f=fake({target:{...previous,id:crypto.randomUUID(),version_code:2000055}});
  assert.equal(await publish(f.client,'production'),'skipped-release-conflict');assert.equal(f.primary,previous.id);
});
test('an existing exact candidate is selected without creating a duplicate',async()=>{
  const target={id:crypto.randomUUID(),channel:release.channel,version_name:release.versionName,
    version_code:release.versionCode,download_url:release.downloadUrl,min_supported_version_code:1};
  const f=fake({target});assert.equal(await publish(f.client,'production'),'published');assert.equal(f.primary,target.id);
  assert.equal(f.calls.some(x=>x.sql.startsWith('INSERT INTO app_release_catalog')),false);
});
test('the catalogue size limit is retained',async()=>{
  const f=fake({count:200});assert.equal(await publish(f.client,'production'),'skipped-catalog-full');assert.equal(f.primary,previous.id);
});

const hasDatabase=!!process.env.BLOFY_TEST_DATABASE_URL;
async function withCatalog(fn) {
  const {default:pg}=await import('pg');
  const {createReleaseCatalog}=await import('../src/release-catalog.mjs');
  const schema='rc0744_'+crypto.randomUUID().replaceAll('-','');
  const setup=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false});
  await setup.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false,options:`-c search_path=${schema}`,max:8});
  try {
    const catalog=createReleaseCatalog(pool,{channel:'testing',versionCode:previous.version_code,versionName:previous.version_name,
      downloadUrl:previous.download_url,minSupportedVersionCode:1,releaseNotes:'previous'});
    await catalog.ensure();
    async function run(failAudit=false) {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(718420640)');
        const outcome=await publish({query:(sql,args)=>{
          if(failAudit&&sql.startsWith('INSERT INTO app_release_audit'))throw new Error('injected audit failure');
          return client.query(sql,args);
        }},'production');
        await client.query('COMMIT');return outcome;
      } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    }
    await fn({pool,catalog,run,createReleaseCatalog});
  } finally {await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
}
test('PostgreSQL: concurrent first-use publication, optional metadata and subsequent admin rollback',{skip:!hasDatabase},async()=>{
  await withCatalog(async({pool,catalog,run,createReleaseCatalog})=>{
    assert.deepEqual((await Promise.all([run(),run()])).sort(),['already-recorded','published']);
    let snapshot=await catalog.list();assert.equal(snapshot.items.length,2);
    assert.equal((await catalog.primary()).versionCode,2000055);assert.equal((await catalog.primary()).minSupportedVersionCode,1);
    const old=snapshot.items.find(x=>x.versionCode===2000053);
    await catalog.mutate('primary',old.id,{expectedRevision:old.revision,expectedSelectionRevision:snapshot.selectionRevision});
    assert.equal(await run(),'already-recorded');
    assert.equal((await createReleaseCatalog(pool).primary()).versionCode,2000053);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM app_release_audit WHERE action=$1',[action])).rows[0].n,1);
  });
});
test('PostgreSQL: failed audit rolls back both selection and inserted release',{skip:!hasDatabase},async()=>{
  await withCatalog(async({pool,catalog,run})=>{
    await assert.rejects(()=>run(true),/injected audit failure/);
    assert.equal((await catalog.primary()).versionCode,2000053);assert.equal((await catalog.list()).items.length,1);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM app_release_audit WHERE action=$1',[action])).rows[0].n,0);
    assert.equal(await run(),'published');
  });
});
