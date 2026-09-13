import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('portal exposes only Xtream and BLOFY subscriber choices and renewal prices', async () => {
  const source = await readFile(new URL('../src/subscriber-portal-ui-hook.mjs', import.meta.url), 'utf8');
  for (const token of [
    "option.value === 'm3u'",
    "option.value = 'blofy'",
    'مشتركين BLOFY',
    'BLOFY_RENEWAL_WHATSAPP',
    '3 شهور',
    '10 ريال',
    '6 شهور',
    '18 ريال',
    'سنة',
    '25 ريال',
    'مدى الحياة',
    '40 ريال',
    'رقم جهازي:'
  ]) assert.ok(source.includes(token), `missing ${token}`);
});
