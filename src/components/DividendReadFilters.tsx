import { useTranslation } from 'react-i18next';
import type { DividendReadFilter } from '../lib/dividendReading';

export default function DividendReadFilters({ value, onChange }: { value: DividendReadFilter; onChange: (value: DividendReadFilter) => void }) {
  const { t } = useTranslation();
  return <div className="div-filters div-read-filters" role="group" aria-label={t('div_read_filter')}>
    {(['all', 'triggered', 'held', 'paused', 'unknown'] as const).map(filter => <button type="button" key={filter}
      className={value === filter ? 'selected' : ''} aria-pressed={value === filter} onClick={() => onChange(filter)}>{t(`div_read_filter_${filter}`)}</button>)}
  </div>;
}
