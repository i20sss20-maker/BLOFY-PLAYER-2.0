const {test,before,after,beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {Pool} = require('../services/activation/node_modules/pg');
const {cleanup,hash} = require('./registration-cleanup.cjs');

// This fixture deliberately resets a disposable database. Refuse every other target.
const address = new URL(process.env.TEST_CLEANUP_DATABASE_URL || 'http://invalid');
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.pathname, '/blofy_cleanup_tests');
const pool = new Pool({connectionString:address.toString(),max:1});
let db;
const stamp = '2026-09-21T10:38:50.561Z';
const batch = 'fixture-ci-registration-cleanup';
const ids = ['BLOFY-TEST-AAAA','BLOFY-TEST-BBBB'];
const manifest = ids.map(id=>({hash:hash(id),created:stamp,updated:stamp,seen:stamp,
  expires:stamp,version:'2.0.0-rc07.55',failed:0,session:'0',rotated:false,
  evidence:{run:1,job:1,sha:'fixture',taskStart:'2026-09-21T10:38:00Z',end:'2026-09-21T10:38:51Z'}}));

before(async()=>{db=await pool.connect();});
after(async()=>{db?.release();await pool.end();});
async function reset() {
  await db.query('DROP SCHEMA IF EXISTS blofy_maintenance CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(fs.readFileSync('services/activation/schema.sql','utf8'));
  await db.query(`INSERT INTO devices(device_id,activation_code,status,trial_registration_pending,
    created_at,updated_at,last_seen_at,expires_at,last_app_version,last_platform)
    SELECT id,'fixture-proof','expired',TRUE,$1,$1,$1,$1,'2.0.0-rc07.55','android'
    FROM unnest($2::text[]) AS item(id)`,[stamp,[...ids,'BLOFY-KEEP-WEBB']]);
  await db.query(`INSERT INTO devices(device_id,activation_code,status)
    VALUES('BLOFY-KEEP-REAL','fixture-paid-proof','active')`);
}
beforeEach(reset);
async function liveCount(){return (await db.query('SELECT count(*)::int AS count FROM devices')).rows[0].count;}

test('only allowlisted devices are archived and removed; archive restores all fields; retry is harmless',async()=>{
  const original=(await db.query('SELECT to_jsonb(d) AS row FROM devices d WHERE device_id=$1',[ids[0]])).rows[0].row;
  const result=await cleanup(db,manifest,batch);
  assert.deepEqual(result,{alreadyCompleted:false,archived:2,deleted:2,
    before:{total:4,pending:3,activated:1},after:{total:2,pending:1,activated:1}});
  const archive=(await db.query('SELECT device_snapshot FROM blofy_maintenance.registration_archive WHERE device_id=$1',[ids[0]])).rows[0];
  assert.deepEqual(archive.device_snapshot,original);
  const again=await cleanup(db,manifest,batch);
  assert.equal(again.alreadyCompleted,true);assert.equal(again.deleted,0);
  assert.equal(await liveCount(),2);
  await db.query(`INSERT INTO devices SELECT (jsonb_populate_record(NULL::devices,device_snapshot)).*
    FROM blofy_maintenance.registration_archive WHERE batch_id=$1`,[batch]);
  assert.equal(await liveCount(),4);
  const restored=(await db.query('SELECT to_jsonb(d) AS row FROM devices d WHERE device_id=$1',[ids[0]])).rows[0].row;
  assert.deepEqual(restored,original);
  await assert.rejects(cleanup(db,manifest,batch),/returned/);
  assert.equal(await liveCount(),4);
});

test('new contact after the audit aborts the entire batch',async()=>{
  await db.query("UPDATE devices SET last_seen_at='2026-09-21T12:00:00Z' WHERE device_id=$1",[ids[1]]);
  await assert.rejects(cleanup(db,manifest,batch),/activity changed/);
  assert.equal(await liveCount(),4);
});

test('a newly active device cannot be removed',async()=>{
  await db.query("UPDATE devices SET status='active' WHERE device_id=$1",[ids[0]]);
  await assert.rejects(cleanup(db,manifest,batch),/entitlement/);
  assert.equal(await liveCount(),4);
});

test('foreign key data is protected even when its column is not named device_id',async()=>{
  await db.query('CREATE TABLE customer_data(link text REFERENCES devices(device_id) ON DELETE CASCADE)');
  await db.query('INSERT INTO customer_data VALUES($1)',[ids[1]]);
  await assert.rejects(cleanup(db,manifest,batch),/Related data/);
  assert.equal(await liveCount(),4);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM customer_data')).rows[0].n,1);
});

test('trial history without a foreign key prevents deletion',async()=>{
  await db.query('INSERT INTO device_trial_claims(scope_hash,first_device_id,expires_at) VALUES($1,$2,NOW())',['fixture-scope',ids[0]]);
  await assert.rejects(cleanup(db,manifest,batch),/Related data/);
  assert.equal(await liveCount(),4);
});

test('recovery targets without a foreign key prevent deletion',async()=>{
  await db.query(`INSERT INTO license_recovery_keys(key_hash,device_id,target_device_id)
    VALUES('fixture-recovery','BLOFY-KEEP-REAL',$1)`,[ids[0]]);
  await assert.rejects(cleanup(db,manifest,batch),/Related data/);
  assert.equal(await liveCount(),4);
});

test('a delete failure rolls back both the archive and every removal',async()=>{
  await db.query(`CREATE FUNCTION reject_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture delete failure'; END $$;
    CREATE TRIGGER reject_fixture_delete BEFORE DELETE ON devices
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_delete()`);
  await assert.rejects(cleanup(db,manifest,batch),/fixture delete failure/);
  assert.equal(await liveCount(),4);
  assert.equal((await db.query("SELECT to_regclass('blofy_maintenance.registration_archive') AS archive")).rows[0].archive,null);
});

test('production manifest contains 172 unique CI-correlated identities and no credentials',()=>{
  const reviewed=JSON.parse(fs.readFileSync('ops/registration-cleanup-20260921.json','utf8'));
  assert.equal(reviewed.length,172);
  assert.equal(new Set(reviewed.map(row=>row.hash)).size,172);
  for(const row of reviewed){
    assert(/^[a-f0-9]{64}$/.test(row.hash));
    assert(Date.parse(row.created)>=Date.parse(row.evidence.taskStart));
    assert(Date.parse(row.created)<Date.parse(row.evidence.end));
    assert(Date.parse(row.updated)-Date.parse(row.created)<=1000);
    assert(!('activation_code' in row));assert(!('device_id' in row));
  }
});
