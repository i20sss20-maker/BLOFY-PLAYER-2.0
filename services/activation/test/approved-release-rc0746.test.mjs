import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  APPROVED_RC0746 as release,
  RC0746_PUBLICATION_ACTION as action,
  publishApprovedRc0746 as publish
} from '../src/approved-release-rc0746.mjs';

const previous = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'testing',
  version_code: 2000056,
  version_name: '2.0.0-rc07.45',
  min_supported_version_code: 1,
  download_url: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.45/BLOFY-PLAYER-2.0-rc07.45-signed.apk'
};

function fake({ current = previous, target = null, done = false, count = 3 } = {}) {
  const calls = [];
  let audit = null;
  let primary = current?.id;
  const client = { query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT * FROM app_release_selection')) return { rows: [{ primary_id: current?.id }] };
    if (sql.startsWith('SELECT 1 FROM app_release_audit')) return { rows: done ? [{ exists: 1 }] : [] };
    if (sql.startsWith('SELECT * FROM app_release_catalog WHERE id=')) return { rows: current ? [current] : [] };
    if (sql.startsWith('SELECT * FROM app_release_catalog WHERE version_code=')) return { rows: target ? [target] : [] };
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ count }] };
    if (sql.startsWith('INSERT INTO app_release_catalog')) return { rows: [{ id: args[0] }] };
    if (sql.startsWith('UPDATE app_release_selection')) { primary = args[0]; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO app_release_audit')) {
      audit = { action: args[0], releaseId: args[1], details: JSON.parse(args[2]) };
      return { rows: [] };
    }
    throw new Error('Unexpected SQL: ' + sql);
  }};
  return { client, calls, get audit() { return audit; }, get primary() { return primary; } };
}

test('rc07.46 metadata matches the verified signed release', () => {
  assert.equal(release.versionCode, 2000057);
  assert.equal(release.versionName, '2.0.0-rc07.46');
  assert.equal(release.channel, 'testing');
  assert.equal(release.sha256, '4130e95b65228db9ec56741c09ba00fca74f216b7a8b29d2bd19709a4fcc1663');
  assert.match(release.downloadUrl, /v2\.0\.0-rc07\.46\/BLOFY-PLAYER-2\.0-rc07\.46-signed\.apk$/);
});

test('publication is disabled outside production', async () => {
  for (const env of ['preview', 'development', undefined]) {
    const f = fake();
    assert.equal(await publish(f.client, env), 'not-production');
    assert.equal(f.calls.length, 0);
  }
});

test('publishes exactly over the observed rc07.45 primary', async () => {
  const f = fake();
  assert.equal(await publish(f.client, 'production'), 'published');
  assert.notEqual(f.primary, previous.id);
  assert.equal(f.audit.action, action);
  assert.equal(f.audit.details.versionCode, 2000057);
  assert.equal(f.audit.details.sha256, release.sha256);
  const insert = f.calls.find(x => x.sql.startsWith('INSERT INTO app_release_catalog'));
  assert.equal(insert.args[2], 2000057);
  assert.equal(insert.args[6], 1);
  assert.equal(f.calls.some(x => /^(DELETE|DROP)/.test(x.sql)), false);
});

test('completed publication never overwrites a later administrator selection', async () => {
  const f = fake({ done: true });
  assert.equal(await publish(f.client, 'production'), 'already-recorded');
  assert.equal(f.calls.some(x => /^(UPDATE|INSERT|DELETE)/.test(x.sql)), false);
});

test('missing changed or newer primary is only audited and never overwritten', async () => {
  for (const current of [
    null,
    { ...previous, version_code: 2000058, version_name: '2.0.0-rc07.47' },
    { ...previous, download_url: 'https://example.invalid/admin-selected.apk' }
  ]) {
    const f = fake({ current });
    assert.equal(await publish(f.client, 'production'), 'skipped-selection-changed');
    assert.equal(f.calls.some(x => x.sql.startsWith('UPDATE app_release_selection')), false);
  }
});

test('conflicting version 57 row is never silently rewritten', async () => {
  const target = { ...previous, id: crypto.randomUUID(), version_code: 2000057 };
  const f = fake({ target });
  assert.equal(await publish(f.client, 'production'), 'skipped-release-conflict');
  assert.equal(f.primary, previous.id);
});

test('exact existing candidate can become primary without duplication', async () => {
  const target = {
    id: crypto.randomUUID(),
    channel: release.channel,
    version_code: release.versionCode,
    version_name: release.versionName,
    download_url: release.downloadUrl,
    min_supported_version_code: release.minSupportedVersionCode
  };
  const f = fake({ target });
  assert.equal(await publish(f.client, 'production'), 'published');
  assert.equal(f.primary, target.id);
  assert.equal(f.calls.some(x => x.sql.startsWith('INSERT INTO app_release_catalog')), false);
});

test('catalog size guard remains fail closed', async () => {
  const f = fake({ count: 200 });
  assert.equal(await publish(f.client, 'production'), 'skipped-catalog-full');
  assert.equal(f.primary, previous.id);
});
