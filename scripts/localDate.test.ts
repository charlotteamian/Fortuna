import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalDate, parseLocalDate } from '../src/lib/localDate.ts';

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
