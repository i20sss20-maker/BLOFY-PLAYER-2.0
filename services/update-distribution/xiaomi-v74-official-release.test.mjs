import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./release-store.mjs', import.meta.url), 'utf8');
test('default public website remains on working signed v75 until owner accepts v74', () => {
  assert.match(source, /const BLOFY_APPROVED_XIAOMI_74 = String\(process\.env\.BLOFY_APPROVED_XIAOMI_74 \|\| ''\)/);
  assert.match(source, /BLOFY_APPROVED_XIAOMI_74 \? approvedXiaomi74Release\(\) : ONLY_75_RELEASE/);
  assert.match(source, /versionCode: 2000075/);
});
test('new v74 display release only accepts a real signed package URL and update-capable code', () => {
  assert.match(source, /BLOFY_APPROVED_XIAOMI_74_APK_URL_required/);
  assert.match(source, /versionCode: 2000080/);
  assert.match(source, /versionName: '2\.0\.0-rc07\.55\.6'/);
  assert.match(source, /tv\.blofy\.player\.xiaomi/);
});
