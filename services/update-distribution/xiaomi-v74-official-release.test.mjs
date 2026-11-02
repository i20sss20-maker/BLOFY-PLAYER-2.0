import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./release-store.mjs', import.meta.url), 'utf8');
test('default public website remains on working signed v75 until owner accepts v74', () => {
  assert.match(source, /const BLOFY_APPROVED_XIAOMI_74 = String\(process\.env\.BLOFY_APPROVED_XIAOMI_74 \|\| ''\)/);
  assert.match(source, /BLOFY_APPROVED_XIAOMI_74 \? approvedXiaomi74Release\(\) : ONLY_75_RELEASE/);
  assert.match(source, /versionCode: 2000075/);
});
test('official v74 display release is blocked from replacing website 75 due to Android downgrade', () => {
  assert.match(source, /BLOFY_APPROVED_XIAOMI_74_APK_URL_required/);
  assert.match(source, /versionCode: 2000074/);
  assert.match(source, /versionName: '2\.0\.0-rc07\.55\.6'/);
  assert.match(source, /blofy_74_2000074_cannot_replace_website_2000075/);
  assert.match(source, /tv\.blofy\.player\.xiaomi/);
});
