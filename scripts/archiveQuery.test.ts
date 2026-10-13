import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ARCHIVE_FILTERS, hasInvalidArchiveDateRange, queryArchive, type ArchiveFilters, type ArchiveSearchItem } from '../src/lib/archiveQuery.ts';

const items: ArchiveSearchItem[] = [
  { id: 'cn', name: 'Bank 10 股份', searchTerms: ['000001'], type: 'A股', date: '2026-10-13', pnlMinor: -26760 },
  { id: 'us', name: 'Apple', searchTerms: ['AAPL'], type: '美股', date: '2026-10-08', pnlMinor: 150000 },
  { id: 'hk', name: 'Bank 2', searchTerms: ['00700'], type: '港股', date: '2026-09-15', pnlMinor: 0 },
  { id: 'empty', name: 'Undated', type: '其他', date: null, pnlMinor: null },
];
const query = (filters: Partial<ArchiveFilters> = {}) => queryArchive(items, { ...DEFAULT_ARCHIVE_FILTERS, ...filters }, 'en').map(item => item.id);

test('archive search matches names and codes, retaining leading zeros and normalising case/full-width input', () => {
  assert.deepEqual(query({ query: '０００００１' }), ['cn']);
  assert.deepEqual(query({ query: ' aApL ' }), ['us']);
  assert.deepEqual(query({ query: '股份' }), ['cn']);
  assert.deepEqual(query({ query: 'Bank 000001' }), ['cn']);
  assert.deepEqual(query({ query: 'Bank aapl' }), []);
});

test('market and inclusive date filters combine with search, using the last record date', () => {
  assert.deepEqual(query({ type: 'A股', startDate: '2026-10-13', endDate: '2026-10-13', query: '000' }), ['cn']);
  assert.deepEqual(query({ type: '美股', startDate: '2026-10-09' }), []);
  assert.deepEqual(query({ endDate: '2026-10-08' }), ['us', 'hk']);
  assert.deepEqual(query({ startDate: '2026-10-08' }), ['cn', 'us']);
});

test('undated archives stay visible without date filters and go last in both date directions', () => {
  assert.deepEqual(query(), ['cn', 'us', 'hk', 'empty']);
  assert.deepEqual(query({ sort: 'date-asc' }), ['hk', 'us', 'cn', 'empty']);
});

test('invalid date ranges show no results rather than silently swapping the requested dates', () => {
  const filters = { ...DEFAULT_ARCHIVE_FILTERS, startDate: '2026-10-13', endDate: '2026-09-01' };
  assert.equal(hasInvalidArchiveDateRange(filters), true);
  assert.deepEqual(queryArchive(items, filters), []);
  assert.equal(hasInvalidArchiveDateRange({ ...filters, endDate: '' }), false);
});

test('names sort in both directions with natural numeric ordering', () => {
  assert.deepEqual(query({ sort: 'name-asc' }), ['us', 'hk', 'cn', 'empty']);
  assert.deepEqual(query({ sort: 'name-desc' }), ['empty', 'cn', 'hk', 'us']);
});

test('P&L sorting includes losses and zero, with unmeasured assets last in either direction', () => {
  assert.deepEqual(query({ sort: 'pnl-desc' }), ['us', 'hk', 'cn', 'empty']);
  assert.deepEqual(query({ sort: 'pnl-asc' }), ['cn', 'hk', 'us', 'empty']);
});

test('sorting and resetting do not mutate the history or filters', () => {
  const before = structuredClone(items);
  query({ sort: 'pnl-asc' });
  assert.deepEqual(items, before);
  assert.equal(DEFAULT_ARCHIVE_FILTERS.sort, 'date-desc');
});

test('same-day archives sort deterministically, including duplicate names', () => {
  const dated = ['c', 'a', 'b'].map(id => ({ ...items[0], id }));
  assert.deepEqual(queryArchive(dated, DEFAULT_ARCHIVE_FILTERS).map(item => item.id), ['a', 'b', 'c']);
});
