import crypto from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

const MARKER = 'BLOFY_MIGRATION_SOURCE_AUDIT_V1';

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function runAudit() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    console.error(`${MARKER} ${JSON.stringify({ ok: false, code: 'database_url_missing' })}`);
    return;
  }

  const pool = new pg.Pool(databaseOptions(connectionString, {
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    lock_timeout: 3_000,
    idle_in_transaction_session_timeout: 15_000,
  }));

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

      const tables = [];
      for (const table of tablesResult.rows) {
        const result = await client.query(
          `SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`
        );
        tables.push({ schema: table.table_schema, table: table.table_name, rows: Number(result.rows[0].count) });
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
      await client.query('ROLLBACK');

      console.log(`${MARKER} ${JSON.stringify({
        ok: true,
        safeAuditVersion: 1,
        database: {
          name: identity.rows[0].database_name,
          schema: identity.rows[0].current_schema,
          serverVersion: identity.rows[0].server_version,
        },
        tableCount: tables.length,
        tables,
        schemaFingerprint,
      })}`);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`${MARKER} ${JSON.stringify({ ok: false, code: String(error?.code || 'audit_failed').slice(0, 64) })}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

// Fire once per Vercel function instance. It is intentionally not awaited so
// normal production request handling is not blocked by this temporary audit.
void runAudit();
