import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import * as auth from '../../src/auth-protection.mjs';

// Exercise the real hook handlers without a socket or production database.
// Only module dependencies are substituted; handler/control-flow source is unchanged.
export async function loadHooks(names, { env = {}, pool, dependencies = {} } = {}) {
  const http = { createServer: (listener) => listener };
  const contexts = [];
  for (const name of names) {
    const source = await readFile(new URL(`../../src/${name}`, import.meta.url), 'utf8');
    const context = vm.createContext({
      http, crypto, pg: { Pool: class { constructor() { return pool; } } },
      ...auth, ...dependencies,
      process: { env }, Buffer, URL, console,
      setTimeout, clearTimeout, setInterval, clearInterval
    });
    vm.runInContext(source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, ''), context, { filename: name });
    contexts.push(context);
  }
  const listener = http.createServer((_req, res) => {
    res.writeHead(404, {});
    res.end('{}');
  });
  return {
    contexts,
    async request(url, { method = 'GET', body, headers = {} } = {}) {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      Object.assign(req, { url, method, headers, socket: { remoteAddress: '127.0.0.1' } });
      const response = {
        status: 0, headers: {}, body: '', headersSent: false,
        writeHead(status, values) { this.status = status; this.headers = values; this.headersSent = true; },
        end(value = '') { this.body += value; },
        destroy() { this.destroyed = true; }
      };
      await listener(req, response);
      return response;
    }
  };
}

export function devicePool(row, otherQuery = async () => ({ rows: [] })) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (sql.startsWith('SELECT * FROM devices')) return { rows: row ? [{ ...row }] : [] };
      if (sql.startsWith('UPDATE devices SET auth_failed_attempts')) {
        Object.assign(row, { auth_failed_attempts: values[1], last_auth_failure_at: values[2], auth_locked_until: values[3] });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE devices SET activation_code')) {
        row.activation_code = values[1];
        return { rows: [] };
      }
      return otherQuery(sql, values);
    },
    async connect() { return { query: pool.query, release() {} }; }
  };
  return pool;
}
