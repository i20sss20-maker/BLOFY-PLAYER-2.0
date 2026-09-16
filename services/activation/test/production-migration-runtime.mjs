import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { ADMIN_CONSOLE_SCHEMA } from '../src/admin-console-schema.mjs';
import { DEVICE_ADMIN_SCHEMA } from '../src/device-admin.mjs';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';
import { loadPersistedDataKey } from '../src/data-key-state.mjs';

const adminUrl = process.env.BLOFY_TEST_DATABASE_URL;
if (!adminUrl || !['127.0.0.1','localhost'].includes(new URL(adminUrl).hostname)) throw new Error('isolated_local_database_required');
const sourceName = `blofy_migration_source_${process.pid}`;
const targetName = `blofy_migration_target_${process.pid}`;
const databaseUrl = name => { const u = new URL(adminUrl); u.pathname = `/${name}`; return u.toString(); };
const sourceUrl = databaseUrl(sourceName), targetUrl = databaseUrl(targetName);
const admin = new pg.Pool({ connectionString: adminUrl });
const sourceKey = 'a'.repeat(64);
const targetWrappingKey = 'b'.repeat(64);
const sourceCodec = createActivationCredentialCodec(sourceKey);
const releaseSchema = `
CREATE TABLE IF NOT EXISTS app_release_catalog (
 id UUID PRIMARY KEY,channel TEXT NOT NULL CHECK(channel IN ('stable','testing')),version_code INTEGER NOT NULL UNIQUE,
 version_name TEXT NOT NULL,download_url TEXT NOT NULL,release_notes TEXT,min_supported_version_code INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS app_release_selection (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),primary_id UUID REFERENCES app_release_catalog(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 1,initialized BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS app_release_audit (
 id BIGSERIAL PRIMARY KEY,action TEXT NOT NULL,release_id UUID NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;

function seal(value,keyHex) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);
  const ciphertext=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');
}
function open(value,keyHex) {
  const payload=Buffer.from(value,'base64url'), iv=payload.subarray(0,12), tag=payload.subarray(12,28), ciphertext=payload.subarray(28);
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
}
async function createDatabase(name) { await admin.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(name) {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}
async function runMigration(extraEnv={}) {
  const child = spawn(process.execPath, ['src/production-migration.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PGSSLMODE:'disable', SOURCE_DATABASE_URL:sourceUrl, DATABASE_URL:targetUrl,
      SOURCE_BLOFY_PLAYLIST_ENCRYPTION_KEY:sourceKey, BLOFY_PLAYLIST_ENCRYPTION_KEY:targetWrappingKey, ...extraEnv },
    stdio:['ignore','pipe','pipe']
  });
  let stdout='', stderr=''; child.stdout.on('data',d=>stdout+=d); child.stderr.on('data',d=>stderr+=d);
  const code = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  return { code, stdout, stderr };
}

try {
  await createDatabase(sourceName); await createDatabase(targetName);
  const source = new pg.Pool({ connectionString:sourceUrl });
  const target = new pg.Pool({ connectionString:targetUrl });
  try {
    const core = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
    await source.query(core); await source.query(ADMIN_CONSOLE_SCHEMA); await source.query(DEVICE_ADMIN_SCHEMA); await source.query(releaseSchema);
    const sourceDevice='BLOFY-MIGRATION-SOURCE', pin='234567';
    await source.query(`INSERT INTO devices(device_id,activation_code,status,expires_at,last_app_version,last_platform)
      VALUES($1,$2,'active',NOW()+INTERVAL '90 days','2.0.0-test','android')`,[sourceDevice,sourceCodec.proof(sourceDevice,pin)]);
    await source.query(`INSERT INTO device_customers(device_id,customer_name,customer_email,customer_phone,source)
      VALUES($1,'عميل اختبار','test@example.invalid','+966500000000','test')`,[sourceDevice]);
    await source.query(`INSERT INTO device_admin_metadata(device_id,notes,revision) VALUES($1,'ملاحظة اختبار',2)`,[sourceDevice]);
    const playlistId=crypto.randomUUID();
    await source.query(`INSERT INTO device_playlists(id,device_id,name,provider_type,base_url_enc,username_enc,password_enc,active,revision)
      VALUES($1,$2,'قائمة اختبار','xtream',$3,$4,$5,TRUE,3)`,[playlistId,sourceDevice,
      seal('https://provider.example',sourceKey),seal('source-user',sourceKey),seal('source-password',sourceKey)]);
    await source.query(`INSERT INTO playback_diagnostics(id,device_id,provider_key,content_kind,ttff_ms,buffering_count,error_code,app_version)
      VALUES(41,$1,'provider-hash','live',850,1,NULL,'2.0.0-test')`,[sourceDevice]);
    await source.query(`INSERT INTO device_trial_claims(scope_hash,first_device_id,started_at,expires_at)
      VALUES('scope-test',$1,NOW()-INTERVAL '1 day',NOW()+INTERVAL '6 days')`,[sourceDevice]);
    await source.query(`INSERT INTO profile_cloud_snapshots(device_id,profile_id,revision,payload_json)
      VALUES($1,'main',4,'{"theme":"purple"}'::jsonb)`,[sourceDevice]);
    await source.query(`INSERT INTO subscription_plans(plan_key,name,duration_days,max_devices,price_minor,currency,active,sort_order)
      VALUES('annual','سنوي',365,1,18000,'SAR',TRUE,1)`);
    const subId=crypto.randomUUID();
    await source.query(`INSERT INTO device_subscriptions(id,device_id,plan_key,starts_at,expires_at,status)
      VALUES($1,$2,'annual',NOW(),NOW()+INTERVAL '365 days','active')`,[subId,sourceDevice]);
    await source.query(`INSERT INTO device_audit(id,device_id,actor,action,details) VALUES(17,$1,'test','migration_fixture','{}')`,[sourceDevice]);
    const releaseId=crypto.randomUUID();
    await source.query(`INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code)
      VALUES($1,'testing',2000099,'2.0.0-test','https://example.com/test.apk','اختبار',1)`,[releaseId]);
    await source.query(`INSERT INTO app_release_selection(singleton,primary_id,revision,initialized) VALUES(TRUE,$1,7,TRUE)`,[releaseId]);
    await source.query(`INSERT INTO app_release_audit(id,action,release_id,details) VALUES(9,'create',$1,'{}')`,[releaseId]);

    const targetDevice='BLOFY-TARGET-SEED';
    await target.query(core); await target.query(ADMIN_CONSOLE_SCHEMA); await target.query(DEVICE_ADMIN_SCHEMA); await target.query(releaseSchema);
    await target.query(`CREATE TABLE blofy_release_store(id SMALLINT PRIMARY KEY,state JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await target.query(`INSERT INTO blofy_release_store(id,state) VALUES(1,'{"activeVersionCode":2000061}'::jsonb)`);
    await target.query(`INSERT INTO devices(device_id,activation_code,status) VALUES($1,'seed-code','expired')`,[targetDevice]);

    let result=await runMigration();
    assert.equal(result.code,0,result.stderr);const dry=JSON.parse(result.stdout);assert.equal(dry.mode,'dry-run');
    assert.equal(dry.keyCompatible,false);assert.equal(dry.keyMigrationMode,'wrap-source-data-key');
    assert.equal(dry.sourceCounts.devices,1);assert.equal(dry.targetCountsBefore.devices,1);

    result=await runMigration({BLOFY_MIGRATION_APPLY:'YES_COPY_BLOFY_PRODUCTION_TO_AZURE',BLOFY_MIGRATION_CONFIRM_SOURCE:sourceName,BLOFY_MIGRATION_CONFIRM_TARGET:targetName});
    assert.equal(result.code,0,result.stderr);const applied=JSON.parse(result.stdout);assert.equal(applied.mode,'applied');
    assert.equal(applied.keyCompatible,false);assert.equal(applied.keyMigrationMode,'wrap-source-data-key');assert.equal(applied.persistedDataKey,true);
    assert.match(applied.backupSchema,/^blofy_backup_\d{14}$/);assert.equal(applied.targetCountsAfter.devices,1);assert.equal(applied.targetCountsAfter.device_playlists,1);
    assert.equal((await target.query('SELECT device_id FROM devices')).rows[0].device_id,sourceDevice);
    assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM device_playlists')).rows[0].n,1);
    assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM playback_diagnostics')).rows[0].n,1);
    assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM device_subscriptions')).rows[0].n,1);
    assert.equal((await target.query('SELECT state->>\'activeVersionCode\' AS v FROM blofy_release_store WHERE id=1')).rows[0].v,'2000061');
    assert.equal((await target.query(`SELECT device_id FROM "${applied.backupSchema}".devices`)).rows[0].device_id,targetDevice);

    const restoredKey=await loadPersistedDataKey(target,targetWrappingKey);
    assert.equal(restoredKey,sourceKey,'Azure wrapping key restores the source production data key');
    const migratedDevice=(await target.query('SELECT * FROM devices WHERE device_id=$1',[sourceDevice])).rows[0];
    assert.equal(createActivationCredentialCodec(restoredKey).matches(migratedDevice,pin),true,'source PIN proof remains valid after migration');
    const migratedPlaylist=(await target.query('SELECT base_url_enc,username_enc,password_enc FROM device_playlists WHERE id=$1',[playlistId])).rows[0];
    assert.equal(open(migratedPlaylist.base_url_enc,restoredKey),'https://provider.example');
    assert.equal(open(migratedPlaylist.username_enc,restoredKey),'source-user');
    assert.equal(open(migratedPlaylist.password_enc,restoredKey),'source-password');
    assert.throws(()=>open(migratedPlaylist.password_enc,targetWrappingKey),'Azure wrapping key is not incorrectly used as the migrated data key');

    const inserted=(await target.query(`INSERT INTO playback_diagnostics(device_id,provider_key,content_kind) VALUES($1,'next','live') RETURNING id`,[sourceDevice])).rows[0].id;
    assert.ok(Number(inserted)>41,'serial sequence advanced after explicit ID migration');

    result=await runMigration({SOURCE_BLOFY_PLAYLIST_ENCRYPTION_KEY:'invalid',BLOFY_MIGRATION_APPLY:'YES_COPY_BLOFY_PRODUCTION_TO_AZURE',BLOFY_MIGRATION_CONFIRM_SOURCE:sourceName,BLOFY_MIGRATION_CONFIRM_TARGET:targetName});
    assert.equal(result.code,1);assert.match(result.stderr,/migration_source_key_invalid/);
    assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM devices')).rows[0].n,1,'failed guarded run leaves target intact');
    console.log('PASS: migration dry-run, different-key wrapping, target backup, canonical copy, PIN/ciphertext preservation, count verification, sequence repair and Azure release-store preservation.');
  } finally { await source.end(); await target.end(); }
} finally {
  await dropDatabase(sourceName).catch(()=>{}); await dropDatabase(targetName).catch(()=>{}); await admin.end();
}
