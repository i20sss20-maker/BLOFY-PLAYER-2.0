import test from 'node:test';
import assert from 'node:assert/strict';
import {RENEWAL_OPTIONS,addCalendarMonths,renewalPreview} from '../src/admin-renewals.mjs';
const stamp=Date.parse;
test('manual renewal offers all five requested durations without checkout prices',()=>{
  assert.deepEqual(RENEWAL_OPTIONS.map(x=>x.months),[1,3,6,12,null]);
  assert.ok(RENEWAL_OPTIONS.every(x=>!('price' in x)));
});
test('calendar months clamp end-of-month and leap-day dates',()=>{
  assert.equal(addCalendarMonths(stamp('2028-01-31T10:00:00Z'),1),stamp('2028-02-29T10:00:00Z'));
  assert.equal(addCalendarMonths(stamp('2028-02-29T10:00:00Z'),12),stamp('2029-02-28T10:00:00Z'));
  assert.equal(addCalendarMonths(stamp('2026-08-31T10:00:00Z'),6),stamp('2027-02-28T10:00:00Z'));
});
test('renewal adds to remaining time and restarts an expired device from now',()=>{
  const now=stamp('2026-09-11T12:00:00Z');
  assert.equal(renewalPreview({status:'active',expires_at:'2026-10-20T12:00:00Z'},'quarter',now).expiresAt,stamp('2027-01-20T12:00:00Z'));
  assert.equal(renewalPreview({status:'expired',expires_at:'2026-08-01T12:00:00Z'},'month',now).expiresAt,stamp('2026-10-11T12:00:00Z'));
});
test('lifetime has no expiry; blocked or lifetime devices cannot be inadvertently changed',()=>{
  assert.equal(renewalPreview({status:'expired',expires_at:null},'lifetime').expiresAt,null);
  assert.throws(()=>renewalPreview({status:'active',expires_at:null},'year'),/already_lifetime/);
  assert.throws(()=>renewalPreview({status:'blocked',expires_at:null},'lifetime'),/device_blocked/);
  assert.throws(()=>renewalPreview({status:'expired'},'unbounded'),/invalid_duration/);
});
