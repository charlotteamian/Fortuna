import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalDate, formatLocalTime, normalizeLocalTime, parseLocalDate, parseLocalDateTimeMs } from '../src/lib/localDate.ts';

test('uses the local calendar day shortly after midnight in Shanghai', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    const shortlyAfterLocalMidnight = new Date('2026-07-27T16:30:00.000Z');

    assert.equal(shortlyAfterLocalMidnight.toISOString().slice(0, 10), '2026-07-27');
    assert.equal(formatLocalDate(shortlyAfterLocalMidnight), '2026-07-28');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('round-trips a local date key without a timezone shift', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(formatLocalDate(parseLocalDate('2026-01-01')), '2026-01-01');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('normalizes wall-clock execution times and converts local date+time without UTC drift', () => {
  assert.equal(normalizeLocalTime('14:30:02'), '14:30:02');
  assert.equal(normalizeLocalTime('9:05:01'), '09:05:01');
  assert.equal(normalizeLocalTime('14:30'), '14:30:00');
  assert.equal(normalizeLocalTime('１３：００：０２'), '13:00:02');
  assert.equal(normalizeLocalTime('24:00:00'), '');
  assert.equal(normalizeLocalTime('12:60:00'), '');
  assert.equal(normalizeLocalTime('10-05'), '');
  const ms = parseLocalDateTimeMs('2026-11-19', '13:00:02');
  assert.ok(ms !== null);
  assert.equal(formatLocalDate(new Date(ms)), '2026-11-19');
  assert.equal(formatLocalTime(new Date(ms)), '13:00:02');
  assert.equal(parseLocalDateTimeMs('2026-02-30', '13:00:02'), null);
});
