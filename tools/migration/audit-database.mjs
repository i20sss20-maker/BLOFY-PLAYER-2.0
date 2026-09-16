import crypto from 'node:crypto';
import pg from 'pg';

const connectionString = String(process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('DATABASE_URL is required. The value is never printed.');
  process.exit(2);
}

const sslMode = (() => {
  try { return new URL(connectionString).searchParams.get('sslmode') || ''; }
  catch { return ''; }
})();
const remote = (() => {
  try {
    const host = new URL(connectionString).hostname;
    return !['localhost', '127.0.0.1', '::1'].includes(host);
  } catch { return true; }
})();

const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000,
  ssl: remote && sslMode !== 'disable' ? { rejectUnauthorized: false } : undefined,
});

const quoteIdent = value => `"${String(value).replaceAll('"', '""')}"`;
const stable = value => JSON.stringify(value, Object.keys(value).sort());

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = await client.query(`
      SELECT current_database() AS database_name,
             current_schema() AS current_schema,
             current_setting('server_version') AS server_version
    `);

    const tablesResult = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type='BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);

    const columnsResult = await client.query(`
      SELECT table_schema, table_name, ordinal_position, column_name, data_type,
             is_nullable, COALESCE(column_default, '') AS column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);

    const counts = [];
    for (const table of tablesResult.rows) {
      const sql = `SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`;
      const result = await client.query(sql);
      counts.push({
        schema: table.table_schema,
        table: table.table_name,
        rows: Number(result.rows[0].count),
      });
    }

    const schemaShape = columnsResult.rows.map(row => ({
      schema: row.table_schema,
      table: row.table_name,
      position: Number(row.ordinal_position),
      column: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable,
      default: row.column_default,
    }));
    const schemaFingerprint = crypto.createHash('sha256').update(JSON.stringify(schemaShape)).digest('hex');

    const report = {
      safeAuditVersion: 1,
      database: {
        name: identity.rows[0].database_name,
        schema: identity.rows[0].current_schema,
        serverVersion: identity.rows[0].server_version,
      },
      tableCount: counts.length,
      tables: counts,
      schemaFingerprint,
      privacy: 'No row values, connection strings, hosts, usernames, passwords, tokens, or customer identifiers are included.',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'audit_failed';
  console.error(`Migration audit failed: ${code}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
