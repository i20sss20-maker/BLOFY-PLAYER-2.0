import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [html,js,admin,gateway,extras]=await Promise.all([
  file('web/sources-admin.html'),
  file('web/sources-admin.js'),
  file('src/xtream-admin-hook.mjs'),
  file('src/xtream-gateway-hook.mjs'),
  file('src/sources-admin-hook.mjs')
]);

test('BLOFY panel contains only Xtream and catalog; plugin extras are retired',()=>{
  assert.doesNotMatch(html,/data-tab="sources"/);
  assert.doesNotMatch(html,/id="tab-sources"/);
  assert.doesNotMatch(js,/loadSources\(/);
  assert.match(html,/id="tab-xtream"/);
  assert.match(html,/id="tab-catalog"/);
  assert.match(extras,/DELETE FROM blofy_source_registry/);
  assert.match(extras,/legacy_plugin_sources_retired/);
  assert.doesNotMatch(extras,/for \(const item of INITIAL_SOURCES\)/);
});

test('source pause and deletion persist and cannot be restored by an active sync',()=>{
  assert.match(admin,/ALTER TABLE blofy_xtream_servers ADD COLUMN IF NOT EXISTS deletion_requested_at/);
  assert.match(admin,/SET enabled=FALSE,publish_catalog=FALSE,status='offline'/);
  assert.match(admin,/deletion_requested_at=COALESCE\(deletion_requested_at,NOW\(\)\)/);
  assert.match(admin,/WHERE deletion_requested_at IS NULL ORDER BY/);
  assert.match(admin,/cancelledSources\.has\(serverId\)/);
  assert.match(admin,/AND enabled=TRUE AND deletion_requested_at IS NULL/);
  assert.match(admin,/async function purgeSource\(id\)/);
  assert.match(admin,/LIMIT 400/);
  assert.match(admin,/status: 409/);
  assert.match(admin,/return json\(res, accepted \? 202 : 404/);
});

test('category orders and hidden states survive resync and reflect in Xtream client lists',()=>{
  assert.match(admin,/ALTER TABLE blofy_xtream_categories ADD COLUMN IF NOT EXISTS sort_order/);
  assert.match(admin,/ORDER BY media_type,sort_order,name LIMIT 5000/);
  assert.match(admin,/WITH ORDINALITY AS rank\(category_id,pos\)/);
  assert.match(admin,/body\.direction!==undefined/);
  assert.match(gateway,/ORDER BY s\.priority,c\.sort_order,c\.name/);
  assert.match(gateway,/m\.media_type=\$1 AND c\.enabled=TRUE AND s\.enabled=TRUE AND s\.publish_catalog=TRUE/);
  assert.match(html,/id="categoryManagerRows"/);
  assert.match(html,/id="categorySearch"/);
  assert.match(js,/async function changeCategory\(button\)/);
  assert.match(js,/await loadCategories\(\)/);
});

test('existing Xtream accounts are not targeted by extras cleanup',()=>{
  const remove=extras.slice(extras.indexOf('async function ensureReady'),extras.indexOf('function origin('));
  assert.match(remove,/DELETE FROM blofy_source_registry/);
  assert.doesNotMatch(remove,/DELETE FROM blofy_xtream_/);
  const procedure=admin.slice(admin.indexOf('async function requestDeleteSource'),admin.indexOf('async function checkedFetch'));
  assert.match(procedure,/UPDATE blofy_xtream_servers/);
  assert.match(procedure,/deletion_requested_at/);
});
