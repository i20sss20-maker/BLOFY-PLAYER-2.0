import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/xtream-admin-hook.mjs', import.meta.url), 'utf8');

test('generic Xtream admin router bypasses dedicated gateway routes first', () => {
  const bypass = source.indexOf("if (url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);");
  const generic = source.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream')) return listener(req, res);");
  assert.notEqual(bypass, -1, 'gateway bypass is missing');
  assert.notEqual(generic, -1, 'generic Xtream route gate is missing');
  assert.ok(bypass < generic, 'gateway bypass must run before the broader /api/v1/admin/xtream route gate');
});
