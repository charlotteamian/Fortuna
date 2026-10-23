import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ARCHIVE_FILTERS, hasInvalidArchiveDateRange, type ArchiveFilters, type ArchiveSort } from '../lib/archiveQuery';
import './ArchiveControls.css';

interface Props {
  filters: ArchiveFilters;
  onChange: (filters: ArchiveFilters) => void;
  typeOptions: { value: string; label: string }[];
  allowPnlSort: boolean;
  dateHint: string;
  searchPlaceholder?: string;
  resultCount: number;
  totalCount: number;
  collapsible?: boolean;
}

const SORTS: ArchiveSort[] = ['date-desc', 'date-asc', 'name-asc', 'name-desc', 'pnl-desc', 'pnl-asc'];

export default function ArchiveControls({ filters, onChange, typeOptions, allowPnlSort, dateHint, searchPlaceholder, resultCount, totalCount, collapsible = false }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const invalidDates = hasInvalidArchiveDateRange(filters);
  const update = (updates: Partial<ArchiveFilters>) => onChange({ ...filters, ...updates });
  const hasFilters = filters.query || filters.type || filters.startDate || filters.endDate || filters.sort !== DEFAULT_ARCHIVE_FILTERS.sort;
  const controls = <>
      <label className="archive-search" htmlFor={`${id}-search`}>
        <span>{t('archive_search')}</span>
        <input id={`${id}-search`} type="search" className="form-input" value={filters.query}
          placeholder={searchPlaceholder ?? t('archive_search_placeholder')} autoComplete="off"
          onChange={event => update({ query: event.target.value })} />
      </label>
      <div className="archive-control-grid">
        {typeOptions.length > 1 && <label htmlFor={`${id}-type`}>
          <span>{t('archive_type')}</span>
          <select id={`${id}-type`} aria-label={t('archive_type')} className="form-select" value={filters.type} onChange={event => update({ type: event.target.value })}>
            <option value="">{t('archive_all_types')}</option>
            {typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
        <label className={typeOptions.length <= 1 ? 'archive-full-width' : undefined} htmlFor={`${id}-sort`}>
          <span>{t('archive_sort')}</span>
          <select id={`${id}-sort`} aria-label={t('archive_sort')} className="form-select" value={filters.sort} onChange={event => update({ sort: event.target.value as ArchiveSort })}>
            {SORTS.filter(sort => allowPnlSort || !sort.startsWith('pnl-')).map(sort => (
              <option key={sort} value={sort}>{t(`archive_sort_${sort}`)}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-start`}>
          <span>{t('archive_start_date')}</span>
          <input id={`${id}-start`} type="date" className="form-input" value={filters.startDate}
            aria-invalid={invalidDates} aria-describedby={`${id}-date-hint`} onChange={event => update({ startDate: event.target.value })} />
        </label>
        <label htmlFor={`${id}-end`}>
          <span>{t('archive_end_date')}</span>
          <input id={`${id}-end`} type="date" className="form-input" value={filters.endDate}
            aria-invalid={invalidDates} aria-describedby={`${id}-date-hint`} onChange={event => update({ endDate: event.target.value })} />
        </label>
      </div>
      <p id={`${id}-date-hint`} className={`archive-date-hint${invalidDates ? ' archive-date-error' : ''}`} role={invalidDates ? 'alert' : undefined}>
        {invalidDates ? t('archive_invalid_dates') : dateHint}
      </p>
      <div className="archive-results-bar">
        <span role="status" aria-live="polite">{t('archive_result_count', { count: resultCount, total: totalCount })}</span>
        {hasFilters && <button type="button" onClick={() => onChange({ ...DEFAULT_ARCHIVE_FILTERS })}>{t('archive_reset')}</button>}
      </div>
      {resultCount === 0 && !invalidDates && <p className="archive-empty">{t('archive_no_results')}</p>}
    </>;
  if (collapsible) return <details className="archive-controls archive-controls-collapsible">
    <summary className="archive-controls-summary">
      <strong>{t('archive_search_filters')}</strong>
      <span className="archive-controls-summary-count" role="status" aria-live="polite">{t('archive_result_count', { count: resultCount, total: totalCount })}</span>
      {hasFilters && <small className={invalidDates ? 'archive-date-error' : undefined}>{t(invalidDates ? 'archive_invalid_dates' : 'archive_filters_active')}</small>}
    </summary>
    <div className="archive-controls-body">{controls}</div>
  </details>;
  return <div className="archive-controls" role="region" aria-label={t('archive_tools')}>{controls}</div>;
}
