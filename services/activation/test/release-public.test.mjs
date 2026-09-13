import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleasePublicHandlers } from '../src/release-public.mjs';
import { CURRENT_RELEASE } from '../src/release-catalog.mjs';
function setup({ dbFailure = false, catalogFailure = false } = {}) {
  const responses = [];
  const selected = { ...CURRENT_RELEASE };
  const catalog = { async appRelease() { if (catalogFailure) throw new Error('offline'); return selected; }, async list() { return { items: [selected] }; } };
  const pool = { async query() { if (dbFailure) throw new Error('offline'); } };
  const routes = createReleasePublicHandlers({ pool, catalog, metadata: { app: { versionCode: 1 } }, json: (res, status, body) => responses.push({ status, body }) });
  return { responses, selected, async call(path, method = 'GET') {
    const headers = {}; const res = { writeHead(status, values) { Object.assign(headers, values); headers.status = status; }, end() {} };
    const handled = await routes.handle({ method }, res, new URL(path, 'https://example.test'));
    return { handled, headers };
  } };
}
test('Android health reflects the explicit selection, including admin changes', async () => {
  const state = setup(); await state.call('/health');
  assert.equal(state.responses[0].body.release.app.versionCode, 2000051);
  state.selected.versionCode = 2000052; await state.call('/health');
  assert.equal(state.responses[1].body.release.app.versionCode, 2000052);
});
test('fixed download uses the same primary and is never permanently cached', async () => {
  const state = setup(); const result = await state.call('/download/latest.apk', 'HEAD');
  assert.equal(result.headers.status, 302); assert.equal(result.headers.location, CURRENT_RELEASE.downloadUrl);
  assert.equal(result.headers['cache-control'], 'no-store');
});
test('release route does not intercept device credentials, playlist or playback requests', async () => {
  const state = setup();
  for (const path of ['/portal', '/api/v1/activation/check', '/api/v1/subscribers/session']) {
    assert.equal((await state.call(path, 'POST')).handled, false);
  }
});
test('catalog errors do not invalidate activation health, but are visible in readiness', async () => {
  const state = setup({ catalogFailure: true }); await state.call('/health');
  assert.equal(state.responses[0].status, 200); assert.equal(state.responses[0].body.releaseCatalog, 'unavailable');
});
test('a failed database still fails the service health check', async () => {
  const state = setup({ dbFailure: true }); await state.call('/health');
  assert.equal(state.responses[0].status, 503); assert.equal(state.responses[0].body.ok, false);
});
