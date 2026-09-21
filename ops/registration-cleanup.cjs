// One-time, allowlisted cleanup of CI registrations. Never emits device credentials.
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const iso = value => value == null ? null : new Date(value).toISOString();
const totalSql = `SELECT COUNT(*)::int AS total,
  COUNT(*) FILTER(WHERE trial_registration_pending AND status='expired')::int AS pending,
  COUNT(*) FILTER(WHERE status IN ('active','trial'))::int AS activated FROM public.devices`;

function validate(row, expected) {
  assert.equal(hash(row.device_id), expected.hash, 'Device changed');
  assert.equal(row.status, 'expired', 'Device has entitlement');
  assert.equal(row.trial_registration_pending, true, 'Registration completed');
  assert.equal(row.trial_started_at, null, 'Trial has started');
  assert.equal(row.data_deleted_at, null, 'Previously deleted device');
  assert.equal(row.auth_locked_until, null, 'Authentication lock requires review');
  assert.equal(row.last_platform, 'android', 'Unexpected registration source');
  assert.equal(row.last_app_version, expected.version, 'Version changed');
  assert.equal(row.auth_failed_attempts, expected.failed, 'Authentication state changed');
  assert.equal(String(row.session_version), String(expected.session), 'Session changed');
  assert.equal(row.activation_rotated_at != null, expected.rotated, 'Credential state changed');
  for (const [column, field] of Object.entries({created_at:'created',updated_at:'updated',last_seen_at:'seen',expires_at:'expires'})) {
    assert.equal(iso(row[column]), expected[field], 'Registration activity changed');
  }
  for (const column of ['updated_at','last_seen_at','last_auth_failure_at','activation_rotated_at']) {
    if (row[column] != null) {
      const elapsed = new Date(row[column]) - new Date(row.created_at);
      assert(elapsed >= 0 && elapsed <= 1000, 'Activity outside the audited test burst');
    }
  }
  const created = Date.parse(expected.created);
  assert(created >= Date.parse(expected.evidence.taskStart) && created < Date.parse(expected.evidence.end),
    'Registration outside its recorded test execution');
}

async function cleanup(client, manifest, batchId) {
  assert(/^[a-z0-9-]+$/.test(batchId));
  assert(manifest.length > 0 && manifest.length <= 172);
  assert.equal(new Set(manifest.map(entry=>entry.hash)).size, manifest.length);
  const manifestHash = hash(JSON.stringify(manifest));
  const allowed = new Map(manifest.map(entry=>[entry.hash,entry]));
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    // Serialize this batch, including retries after a lost console connection.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blofy-cleanup:'+batchId]);
    const present = (await client.query('SELECT device_id FROM public.devices')).rows
      .filter(row=>allowed.has(hash(row.device_id)));
    const archiveExists = (await client.query("SELECT to_regclass('blofy_maintenance.registration_archive') AS relation")).rows[0].relation;
    if (archiveExists) {
      const archived = (await client.query(`SELECT device_id,manifest_hash FROM blofy_maintenance.registration_archive
        WHERE batch_id=$1`, [batchId])).rows;
      if (archived.length) {
        assert.equal(archived.length, manifest.length, 'Partial archive requires review');
        assert(archived.every(row=>row.manifest_hash===manifestHash && allowed.has(hash(row.device_id))), 'Archive mismatch');
        assert.equal(present.length, 0, 'An archived device has returned; do not delete it again');
        const totals = (await client.query(totalSql)).rows[0];
        await client.query('COMMIT');
        return {alreadyCompleted:true,archived:archived.length,deleted:0,after:totals};
      }
    }
    assert.equal(present.length, manifest.length, 'Audited device set changed');
    const ids = present.map(row=>row.device_id).sort();
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('blofy-register:'||id))
      FROM unnest($1::text[]) AS entry(id) ORDER BY id`, [ids]);
    const foreignKeys = (await client.query(`SELECT ns.nspname AS schema,rel.relname AS table,
      att.attname AS column,cardinality(con.conkey) AS width FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
      WHERE con.contype='f' AND con.confrelid='public.devices'::regclass`)).rows;
    assert(foreignKeys.every(ref=>ref.width===1), 'Composite reference requires review');
    // Also protect references without an FK, including trial claims and recovery targets.
    const namedRefs = (await client.query(`SELECT table_schema AS schema,table_name AS table,column_name AS column
      FROM information_schema.columns c WHERE table_schema='public' AND table_name<>'devices'
      AND column_name ~ '(^|_)device_id$' AND data_type IN ('text','character varying')
      AND EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema=c.table_schema
        AND t.table_name=c.table_name AND t.table_type='BASE TABLE')`)).rows;
    const refs = [...new Map([...foreignKeys,...namedRefs].map(ref=>[
      JSON.stringify([ref.schema,ref.table,ref.column]),ref])).values()];
    const tables = [...new Set(['"public"."devices"',...refs.map(ref=>quote(ref.schema)+'.'+quote(ref.table))])].sort();
    // Briefly block writes while rechecking references and archiving. Reads remain available.
    // A busy table aborts the whole transaction after 3 seconds, with no partial deletion.
    await client.query('LOCK TABLE '+tables.join(',')+' IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await client.query('SELECT * FROM public.devices WHERE device_id=ANY($1::text[]) FOR UPDATE', [ids])).rows;
    assert.equal(rows.length, manifest.length);
    for (const row of rows) validate(row, allowed.get(hash(row.device_id)));
    for (const ref of refs) {
      const result = await client.query(`SELECT 1 FROM ${quote(ref.schema)}.${quote(ref.table)}
        WHERE ${quote(ref.column)}=ANY($1::text[]) LIMIT 1`, [ids]);
      assert.equal(result.rowCount, 0, 'Related data requires review: '+ref.table+'.'+ref.column);
    }
    const before = (await client.query(totalSql)).rows[0];
    await client.query('CREATE SCHEMA IF NOT EXISTS blofy_maintenance');
    await client.query('REVOKE ALL ON SCHEMA blofy_maintenance FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS blofy_maintenance.registration_archive (
      batch_id text NOT NULL,device_id text NOT NULL,manifest_hash text NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT NOW(),device_snapshot jsonb NOT NULL,
      evidence jsonb NOT NULL,PRIMARY KEY(batch_id,device_id))`);
    await client.query('REVOKE ALL ON blofy_maintenance.registration_archive FROM PUBLIC');
    const inserted = await client.query(`INSERT INTO blofy_maintenance.registration_archive
      (batch_id,device_id,manifest_hash,device_snapshot,evidence)
      SELECT $1,d.device_id,$2,to_jsonb(d),entry.evidence FROM public.devices d
      JOIN unnest($3::text[],$4::jsonb[]) AS entry(id,evidence) ON entry.id=d.device_id`,
      [batchId,manifestHash,ids,ids.map(id=>JSON.stringify({reason:'CI startup registration',
        ...allowed.get(hash(id)).evidence}))]);
    assert.equal(inserted.rowCount, manifest.length, 'Archive incomplete');
    const removed = await client.query('DELETE FROM public.devices WHERE device_id=ANY($1::text[])', [ids]);
    assert.equal(removed.rowCount, manifest.length, 'Delete set changed');
    const after = (await client.query(totalSql)).rows[0];
    assert.equal(after.total, before.total-manifest.length);
    assert.equal(after.pending, before.pending-manifest.length);
    assert.equal(after.activated, before.activated);
    await client.query('COMMIT');
    return {alreadyCompleted:false,archived:inserted.rowCount,deleted:removed.rowCount,before,after};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = {cleanup,hash};
