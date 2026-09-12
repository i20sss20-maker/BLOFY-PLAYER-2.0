import http from 'node:http';
import pg from 'pg';
import { createSubscriberResolveHandler } from './subscriber-resolve.mjs';

// Add the Android sync endpoint missing from the website branch. Do not alter the
// existing portal, subscriber session creation or any media/proxy playback route.
const pool = process.env.DATABASE_URL ? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000, statement_timeout: 6000
}) : null;
pool?.on('error', () => console.error('subscriber_resolve_database_unavailable'));
const handle = createSubscriberResolveHandler({
  pool,
  keyHex: String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim(),
  subscriberHost: process.env.BLOFY_SUBSCRIBER_HOST,
  report: code => console.warn(code)
});
const previousCreateServer = http.createServer.bind(http);
http.createServer = function withSubscriberResolve(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    if (await handle(req, res)) return;
    return listener(req, res);
  });
};
