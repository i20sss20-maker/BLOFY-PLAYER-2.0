import http from 'node:http';
import pg from 'pg';
import { createDeviceInsightsHandler } from './admin-device-insights.mjs';

// Keep the existing read-only HTML/JSON inventory available alongside the
// new interactive management view. Both adapters require admin authentication.
const pool = process.env.DATABASE_URL ? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000, statement_timeout: 6000
}) : null;
pool?.on('error', () => console.warn('device_insights_database_unavailable'));
const handle = createDeviceInsightsHandler({ pool, adminToken: String(process.env.BLOFY_ADMIN_TOKEN || '').trim() });
const previous = http.createServer.bind(http);
http.createServer = function withDeviceInsights(listener) {
  if (typeof listener !== 'function') return previous(listener);
  return previous(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/api/v1/admin/device-insights' && url.searchParams.get('format') === 'manage') return listener(req, res);
    if (await handle(req, res)) return;
    return listener(req, res);
  });
};
