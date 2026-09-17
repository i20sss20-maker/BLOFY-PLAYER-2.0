import test from 'node:test';
import assert from 'node:assert/strict';
import { RENEWAL_OPTIONS, addCalendarMonths, renewalPreview } from '../src/admin-renewals.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

test('admin renewal options expose an exact seven-day week', () => {
  const week = RENEWAL_OPTIONS.find(option => option.key === 'week');
  assert.deepEqual(week, { key: 'week', name: 'أسبوع (7 أيام)', days: 7 });
});

test('week preview grants exactly seven days from now when no time remains', () => {
  const now = Date.UTC(2026, 8, 15, 2, 0, 0);
  const preview = renewalPreview({ status: 'expired', expires_at: null }, 'week', now);
  assert.equal(preview.startsAt, now);
  assert.equal(preview.expiresAt, now + (7 * DAY_MS));
});

test('expired device with an old expiry is reactivated from now, not from the old date', () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0);
  const oldExpiry = now - (45 * DAY_MS);
  const preview = renewalPreview({ status: 'expired', expires_at: new Date(oldExpiry) }, 'month', now);
  assert.equal(preview.previousExpiresAt, oldExpiry);
  assert.equal(preview.startsAt, now);
  assert.equal(preview.expiresAt, addCalendarMonths(now, 1));
});

test('stale active status with a past expiry still renews from now', () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0);
  const oldExpiry = now - (2 * DAY_MS);
  const preview = renewalPreview({ status: 'active', expires_at: new Date(oldExpiry) }, 'week', now);
  assert.equal(preview.startsAt, now);
  assert.equal(preview.expiresAt, now + (7 * DAY_MS));
});

test('week preview adds seven days after the existing remaining time', () => {
  const now = Date.UTC(2026, 8, 15, 2, 0, 0);
  const currentExpiry = now + (2 * DAY_MS);
  const preview = renewalPreview({ status: 'active', expires_at: new Date(currentExpiry) }, 'week', now);
  assert.equal(preview.startsAt, currentExpiry);
  assert.equal(preview.expiresAt, currentExpiry + (7 * DAY_MS));
});

test('existing calendar-month behavior remains unchanged', () => {
  assert.equal(
    addCalendarMonths(Date.UTC(2026, 0, 31, 12, 30, 0), 1),
    Date.UTC(2026, 1, 28, 12, 30, 0)
  );
});
