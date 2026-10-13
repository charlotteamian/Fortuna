export type ArchiveSort = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'pnl-desc' | 'pnl-asc';

export interface ArchiveFilters {
  query: string;
  type: string;
  startDate: string;
  endDate: string;
  sort: ArchiveSort;
}

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  query: '', type: '', startDate: '', endDate: '', sort: 'date-desc',
};

export interface ArchiveSearchItem {
  id: string;
  name: string;
  searchTerms?: (string | undefined)[];
  type: string;
  date: string | null;
  /** Comparable amount in one currency; null means this asset has no P&L measure. */
  pnlMinor: number | null;
}

function searchText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function hasInvalidArchiveDateRange(filters: ArchiveFilters): boolean {
  return Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate);
}

/** Filter a view of history without changing the ledger or the source display order. */
export function queryArchive<T extends ArchiveSearchItem>(items: T[], filters: ArchiveFilters, locale = 'zh'): T[] {
  if (hasInvalidArchiveDateRange(filters)) return [];
  const terms = searchText(filters.query).split(/\s+/u).filter(Boolean);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const matches = items.filter(item => {
    if (filters.type && item.type !== filters.type) return false;
    // Undated history stays visible without a date filter; never invent a trade date.
    if ((filters.startDate || filters.endDate) && !item.date) return false;
    if (filters.startDate && item.date! < filters.startDate) return false;
    if (filters.endDate && item.date! > filters.endDate) return false;
    const text = [item.name, ...(item.searchTerms ?? [])].map(value => searchText(value ?? '')).join(' ');
    return terms.every(term => text.includes(term));
  });
  const compareNullable = (a: string | number | null, b: string | number | null, ascending: boolean): number => {
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    const difference = typeof a === 'number' && typeof b === 'number'
      ? a - b : String(a).localeCompare(String(b));
    return ascending ? difference : -difference;
  };
  return matches.sort((a, b) => {
    let comparison: number;
    if (filters.sort.startsWith('name-')) {
      comparison = collator.compare(a.name, b.name) * (filters.sort === 'name-asc' ? 1 : -1);
    } else if (filters.sort.startsWith('pnl-')) {
      comparison = compareNullable(a.pnlMinor, b.pnlMinor, filters.sort === 'pnl-asc');
    } else {
      comparison = compareNullable(a.date, b.date, filters.sort === 'date-asc');
    }
    return comparison || collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  });
}
