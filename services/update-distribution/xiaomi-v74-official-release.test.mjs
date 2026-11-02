import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./release-store.mjs', import.meta.url), 'utf8');
test('default public website remains on signed 75 until owner accepts v76', () => {
  assert.match(source, /const BLOFY_APPROVED_BLOFY_76 = String\(process\.env\.BLOFY_APPROVED_BLOFY_76 \|\| ''\)/);
  assert.match(source, /BLOFY_APPROVED_BLOFY_76 \? approvedBlofy76Release\(\) : ONLY_75_RELEASE/);
  assert.match(source, /versionCode: 2000075/);
});
test('candidate v76 can update website 75 but requires opt-in and signed APK', () => {
  assert.match(source, /BLOFY_APPROVED_BLOFY_76_APK_URL_required/);
  assert.match(source, /versionCode: 2000076/);
  assert.match(source, /versionName: '2\.0\.0-rc07\.55\.6'/);
  assert.match(source, /blofy_76_versioncode_not_newer_than_website/);
  assert.match(source, /tv\.blofy\.player\.xiaomi/);
});
