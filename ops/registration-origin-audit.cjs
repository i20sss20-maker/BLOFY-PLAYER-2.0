// Read-only production diagnosis. Never selects credentials, names or playlist contents.
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const screenshotHashes = [
  'b58d4df209697a52a399e8c23a5a9266506a6f80c1eca9441602299bbd033ab2',
  '318f82c43c07186aa81605f2b3f3f65f321498a5abe056b9e0674749be458106',
  '4f7368e02caa0e55f7b4bcb84bf4a363869811899731e26c11869e23ce70fd42',
  '47470e216746fb25bbba879ac2f1ffc8d2808ca56699802e853fc8b27bc44139',
  '4261ca247dfd41eaf796613d70c89f57d7595d976f94a7b7e03366716edda2ea',
  '7af5ed9f4e7a8559ba1cdc6798e48a1afe76d33a398bbc5480225dc512c78f0f',
  'f869efd5ecf4828ea7580ccdf6436734e9f70cd7f2789f6783c09b8fb5a3dabc'
];
const tag = id => createHash('sha256').update(id).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';

(async () => {
  const { databaseOptions } = await import('/app/src/database-options.mjs');
  const pool = new Pool(databaseOptions(process.env.DATABASE_URL, {
    max:1, application_name:'blofy-registration-origin-audit', connectionTimeoutMillis:10000
  }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    const totals = (await client.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE trial_registration_pending AND status='expired')::int AS pending,
      COUNT(*) FILTER(WHERE status IN ('active','trial'))::int AS activated
      FROM devices`)).rows[0];
    const rows = (await client.query(`SELECT device_id,status,created_at,updated_at,last_seen_at,
      trial_started_at,expires_at,last_app_version,last_platform,auth_failed_attempts,
      session_version,trial_registration_pending,
      (activation_rotated_at IS NOT NULL) AS credential_rotated,
      (data_deleted_at IS NOT NULL) AS data_deleted
      FROM devices WHERE trial_registration_pending AND status='expired'
      ORDER BY created_at DESC LIMIT 2000`)).rows;
    const ids = rows.map(row=>row.device_id);
    const related = new Map(ids.map(id=>[id,{}]));
    const refs = (await client.query(`SELECT ns.nspname AS schema,rel.relname AS table,
      att.attname AS column FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
      WHERE con.contype='f' AND con.confrelid='public.devices'::regclass
        AND cardinality(con.conkey)=1`)).rows;
    refs.push({schema:'public',table:'device_trial_claims',column:'first_device_id'});
    for (const ref of refs) {
      const result=await client.query(`SELECT ${quote(ref.column)} AS id, COUNT(*)::int AS count
        FROM ${quote(ref.schema)}.${quote(ref.table)} WHERE ${quote(ref.column)}=ANY($1::text[])
        GROUP BY ${quote(ref.column)}`, [ids]);
      for (const row of result.rows) related.get(row.id)[ref.table+'.'+ref.column]=row.count;
    }
    const report=rows.map(({device_id,...row})=>({
      deviceHash:tag(device_id), screenshotRow:screenshotHashes.indexOf(tag(device_id))+1,
      ...row, related:related.get(device_id)
    }));
    await client.query('ROLLBACK');
    console.log('BLOFY_REGISTRATION_AUDIT='+JSON.stringify({readOnly:true,totals,rows:report}));
    console.log('BLOFY_REGISTRATION_AUDIT_OK');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release(); await pool.end();
  }
})().catch(error=>{
  console.error('BLOFY_REGISTRATION_AUDIT_FAILED='+String(error.code || error.name));
  process.exitCode=1;
});
