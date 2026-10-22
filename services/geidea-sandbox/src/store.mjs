import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRICE_MINOR } from './config.mjs';

export class OrderStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders (
        reference TEXT PRIMARY KEY,
        idempotencyKey TEXT NOT NULL UNIQUE,
        network TEXT NOT NULL,
        scenario TEXT NOT NULL,
        amountMinor INTEGER NOT NULL CHECK(amountMinor=100),
        currency TEXT NOT NULL CHECK(currency='SAR'),
        status TEXT NOT NULL,
        sessionId TEXT UNIQUE,
        expiresAt TEXT,
        providerOrderId TEXT UNIQUE,
        providerStatus TEXT,
        providerDetailedStatus TEXT,
        responseCode TEXT,
        detailedResponseCode TEXT,
        observedNetwork TEXT,
        providerVerified INTEGER NOT NULL DEFAULT 0,
        callbackVerified INTEGER NOT NULL DEFAULT 0,
        errorCode TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS callbacks (
        digest TEXT PRIMARY KEY,
        reference TEXT NOT NULL REFERENCES orders(reference),
        receivedAt TEXT NOT NULL
      );
      PRAGMA foreign_keys=ON;
      UPDATE orders SET status='create_unknown', errorCode='sandbox_creation_interrupted'
      WHERE status='creating';
    `);
  }
  get(reference) { return this.db.prepare('SELECT * FROM orders WHERE reference=?').get(reference); }
  byKey(key) { return this.db.prepare('SELECT * FROM orders WHERE idempotencyKey=?').get(key); }
  list() { return this.db.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 50').all(); }
  create(key, network, scenario) {
    const now = new Date().toISOString();
    const reference = randomUUID();
    this.db.prepare(`INSERT INTO orders
      (reference,idempotencyKey,network,scenario,amountMinor,currency,status,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'SAR','creating',?,?)`).run(reference, key, network, scenario, PRICE_MINOR, now, now);
    return this.get(reference);
  }
  patch(reference, patch) {
    const allowed = new Set(['status', 'sessionId', 'expiresAt', 'providerOrderId', 'providerStatus',
      'providerDetailedStatus', 'responseCode', 'detailedResponseCode', 'observedNetwork',
      'providerVerified', 'callbackVerified', 'errorCode']);
    const entries = Object.entries(patch);
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new Error('sandbox_store_invalid_patch');
    this.db.prepare(`UPDATE orders SET ${entries.map(([key]) => key + '=?').join(',')},updatedAt=? WHERE reference=?`)
      .run(...entries.map(([, value]) => value), new Date().toISOString(), reference);
    return this.get(reference);
  }
  hasCallback(digest) { return Boolean(this.db.prepare('SELECT 1 FROM callbacks WHERE digest=?').get(digest)); }
  commitVerified(reference, patch, digest = null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(reference);
      // Concurrent deliveries must never clear evidence from a verified webhook.
      if (current.callbackVerified) patch = { ...patch, callbackVerified: 1 };
      this.patch(reference, patch);
      if (digest) this.db.prepare('INSERT OR IGNORE INTO callbacks VALUES (?,?,?)')
        .run(digest, reference, new Date().toISOString());
      this.db.exec('COMMIT');
      return this.get(reference);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.db.close(); }
}

export function publicOrder(order) {
  return Object.fromEntries(['reference', 'network', 'scenario', 'amountMinor', 'currency', 'status',
    'sessionId', 'expiresAt', 'providerOrderId', 'providerStatus', 'providerDetailedStatus',
    'responseCode', 'detailedResponseCode', 'observedNetwork', 'providerVerified', 'callbackVerified',
    'errorCode', 'createdAt', 'updatedAt'].map(key => [key, order[key] ?? null]));
}
