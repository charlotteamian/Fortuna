import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { getChartData, getAccountsWithLatest } from '../services/assetService';
import { initializeSettings, getTheme } from '../db';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../app-context';

type TimeRange = '3m' | '6m' | '1y' | 'all' | 'quarter' | 'year';
type ChartData = Awaited<ReturnType<typeof getChartData>>;
type ChartRow = { date: string } & Record<string, string | number>;
type PieDatum = { name: string; value: number; category?: string; currency?: string };
type AssetPieDatum = { name: string; value: number; category: string; currency: string };
type TooltipPayload = { name: string; value: number; color?: string };
type TooltipProps = { active?: boolean; payload?: TooltipPayload[]; label?: string };


const COLORS = ['#818cf8', '#34d399', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#fb7185', '#2dd4bf', '#e879f9'];

/** Generate fixed-frequency date ticks between min/max */
function generateFixedTicks(dates: string[], range: TimeRange): string[] {
  if (dates.length === 0) return [];
  if (range === 'year') return dates; // already aggregated
  if (range === 'quarter') return dates; // already aggregated

  const minDate = new Date(dates[0]);
  const maxDate = new Date(dates[dates.length - 1]);
  const ticks: string[] = [];

  // Determine interval
  let intervalMonths: number;
  if (range === '3m') intervalMonths = 1;
  else if (range === '6m') intervalMonths = 1;
  else if (range === '1y') intervalMonths = 2;
  else {
    // 'all' — use months if < 3 years, else quarters
    const spanMs = maxDate.getTime() - minDate.getTime();
    const spanYears = spanMs / (365.25 * 24 * 60 * 60 * 1000);
    intervalMonths = spanYears > 3 ? 3 : spanYears > 1 ? 2 : 1;
  }

  // Start from 1st of min's month
  const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cursor <= maxDate) {
    ticks.push(cursor.toISOString().split('T')[0]);
    cursor.setMonth(cursor.getMonth() + intervalMonths);
  }
  // Always include last
  const lastTick = maxDate.toISOString().split('T')[0];
  if (!ticks.includes(lastTick)) ticks.push(lastTick);
  return ticks;
}

/** Interpolate a value map to fixed ticks (carry-forward) */
function interpolateToTicks(ticks: string[], valuesMap: Record<string, number>, allDates: string[]): Record<string, number> {
  const sorted = allDates.sort();
  const result: Record<string, number> = {};
  for (const tick of ticks) {
    let val = 0;
    for (const d of sorted) {
      if (d <= tick) val = valuesMap[d] ?? val;
      else break;
    }
    result[tick] = val;
  }
  return result;
}

function aggregateByPeriod(dates: string[], values: Record<string, number>, period: 'quarter' | 'year'): { labels: string[]; data: Record<string, number> } {
  const buckets: Record<string, { label: string; date: string; val: number }> = {};
  for (const d of dates) {
    const dt = new Date(d);
    let key: string;
    if (period === 'year') key = String(dt.getFullYear());
    else { const q = Math.ceil((dt.getMonth() + 1) / 3); key = `${dt.getFullYear()}-Q${q}`; }
    if (!buckets[key] || d >= buckets[key].date) buckets[key] = { label: key, date: d, val: values[d] ?? 0 };
  }
  const sorted = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  return { labels: sorted.map(s => s.label), data: Object.fromEntries(sorted.map(s => [s.label, s.val])) };
}

export default function ChartPage() {
  const { t, i18n } = useTranslation();
  const { amountVisible } = useAppContext();
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [primaryCurrency, setPrimaryCurrency] = useState('CNY');
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [pieData, setPieData] = useState<AssetPieDatum[]>([]);
  const [themeColors, setThemeColors] = useState(getTheme('emerald-rose'));
  const [institutionPieData, setInstitutionPieData] = useState<PieDatum[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [data, settings, acctData] = await Promise.all([getChartData(), initializeSettings(), getAccountsWithLatest()]);
      setChartData(data);
      setPrimaryCurrency(settings.primaryCurrency);
      setThemeColors(getTheme(settings.colorTheme));
      const assetAccts = acctData.accounts.filter(a => a.type === 'asset' && a.convertedAmount > 0);
      setPieData(assetAccts.map(a => ({ name: a.name, category: a.category, currency: a.currency, value: Math.round(a.convertedAmount) })));
      const byInstitution: Record<string, number> = {};
      for (const a of acctData.accounts.filter(x => x.type === 'asset' && x.convertedAmount > 0)) {
        const inst = a.institution?.trim() || '（未设置）';
        byInstitution[inst] = (byInstitution[inst] || 0) + Math.round(a.convertedAmount);
      }
      setInstitutionPieData(Object.entries(byInstitution).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));
      setLoading(false);
    })();
  }, []);

  const filterDates = (dates: string[]) => {
    if (timeRange === 'all' || timeRange === 'quarter' || timeRange === 'year') return dates;
    const now = new Date();
    const months = timeRange === '3m' ? 3 : timeRange === '6m' ? 6 : 12;
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
    return dates.filter(d => new Date(d) >= cutoff);
  };

  const masked = (text: string) => amountVisible ? text : '****';

  const fmt = (n: number) => {
    const isEn = i18n.language.startsWith('en');
    if (isEn) {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + t('unit_yi');
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + t('unit_wan');
      return n.toFixed(0);
    }
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + t('unit_yi');
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + t('unit_wan');
    return n.toFixed(0);
  };

  const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, maxWidth: 280 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0 }}>{masked(fmt(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  // Build chart data
  const chartContent = useMemo(() => {
    if (!chartData) return null;
    const filteredDates = filterDates(chartData.dates);
    if (filteredDates.length === 0) return null;
    const isAggregated = timeRange === 'quarter' || timeRange === 'year';

    // Fixed-frequency ticks
    const ticks = isAggregated ? [] : generateFixedTicks(filteredDates, timeRange);
    const formatLabel = (d: string) => isAggregated ? d : d.slice(5); // MM-DD

    // Total series
    const buildTotalData = (valMap: Record<string, number>, label: string) => {
      if (isAggregated) {
        const agg = aggregateByPeriod(filteredDates, valMap, timeRange as 'quarter' | 'year');
        return agg.labels.map(l => ({ date: l, [label]: agg.data[l] || 0 }));
      }
      const interp = interpolateToTicks(ticks, valMap, filteredDates);
      return ticks.map(tick => ({ date: formatLabel(tick), [label]: interp[tick] || 0 }));
    };

    const totalAssetsData = buildTotalData(chartData.totalSeries.totalAssets, t('total_assets_val'));
    const netWorthData = buildTotalData(chartData.totalSeries.netWorth, t('net_worth_val'));

    // Breakdown for category
    const series = chartData.categorySeries;
    const breakdownKeys = Object.keys(series).filter(k => series[k].type === 'asset');

    let breakdownData: ChartRow[];
    if (isAggregated) {
      const aggLabels = aggregateByPeriod(filteredDates, chartData.totalSeries.totalAssets, timeRange as 'quarter' | 'year').labels;
      breakdownData = aggLabels.map(label => {
      const item: ChartRow = { date: label };
        for (const key of breakdownKeys) {
          const agg = aggregateByPeriod(filteredDates, series[key].values, timeRange as 'quarter' | 'year');
          item[t(key)] = agg.data[label] || 0;
        }
        return item;
      });
    } else {
      breakdownData = ticks.map(tickDate => {
        const item: ChartRow = { date: formatLabel(tickDate) };
        for (const key of breakdownKeys) {
          const interp = interpolateToTicks(ticks, series[key].values, filteredDates);
          item[t(key)] = interp[tickDate] || 0;
        }
        return item;
      });
    }

    // Pie data
    const currencyPieFinal = Object.values(pieData.reduce((acc: Record<string, PieDatum>, item) => {
      const cName = t(item.currency + '_name');
      const finalName = cName !== (item.currency + '_name') ? cName : item.currency;
      if (!acc[item.currency]) acc[item.currency] = { name: finalName, value: 0 };
      acc[item.currency].value += item.value;
      return acc;
    }, {})).sort((a, b) => b.value - a.value);

    // 按产品类型 = 按账户分类汇总
    const productPieFinal = Object.values(pieData.reduce((acc: Record<string, PieDatum>, item) => {
      const key = item.category;
      if (!acc[key]) acc[key] = { name: t(key), value: 0 };
      acc[key].value += item.value;
      return acc;
    }, {})).sort((a, b) => b.value - a.value);

    return { totalAssetsData, netWorthData, breakdownData, breakdownKeys, currencyPieFinal, productPieFinal };
  }, [chartData, timeRange, pieData]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!chartContent) return (
    <>
      <div className="page-header"><div><h1 className="page-title">{t('chart_analysis')}</h1><p className="page-subtitle">{t('visualize_assets')}</p></div></div>
      <div className="empty-state"><div className="empty-icon">📈</div><div className="empty-text">{t('no_data')}</div><div className="empty-hint">{t('no_data_hint')}</div></div>
    </>
  );

  const { totalAssetsData, netWorthData, breakdownData, breakdownKeys, currencyPieFinal, productPieFinal } = chartContent;

  const renderMiniChart = (data: ChartRow[], dataKey: string, color: string, title: string) => (
    <div className="chart-card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>{title}</div>
      {data.length < 2 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontSize: 12 }}>{t('not_enough_data')}</div>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: '#5a6478', fontSize: 10 }} />
            <YAxis tickFormatter={(v: number) => amountVisible ? fmt(v) : '****'} tick={{ fill: '#5a6478', fontSize: 10 }} width={45} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 2, fill: color }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">{t('chart_analysis')}</h1><p className="page-subtitle">{t('visualize_assets')}</p></div></div>


      {/* Time range */}
      <div className="filter-bar">
        {([['3m', '3M'], ['6m', '6M'], ['1y', '1Y'], ['quarter', 'Q'], ['year', 'Y'], ['all', 'All']] as [TimeRange, string][]).map(([k, l]) => (
          <button key={k} className={`filter-chip ${timeRange === k ? 'active' : ''}`} onClick={() => setTimeRange(k)}>{l}</button>
        ))}
      </div>

      {/* Stacked trend charts */}
      <div className="chart-section">
        <div className="chart-title">{t('trend_overview')}</div>
        <div className="chart-subtitle">{t('unit')} {primaryCurrency}</div>
        {renderMiniChart(totalAssetsData, t('total_assets_val'), themeColors.assetColor, `📈 ${t('total_assets_val')}`)}
        {renderMiniChart(netWorthData, t('net_worth_val'), '#818cf8', `💎 ${t('net_worth_val')}`)}

        {/* Per-category breakdown */}
        <div className="chart-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
            📊 {t('by_category')}
          </div>
          {breakdownData.length < 2 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontSize: 12 }}>{t('not_enough_data')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={breakdownData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#5a6478', fontSize: 10 }} />
                <YAxis tickFormatter={(v: number) => amountVisible ? fmt(v) : '****'} tick={{ fill: '#5a6478', fontSize: 10 }} width={45} />
                <Tooltip content={<CustomTooltip />} />
                {breakdownKeys.map((key, i) => (
                  <Line key={key} type="monotone" dataKey={t(key)}
                    stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2, fill: COLORS[i % COLORS.length] }} />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Pie chart */}
      <div className="chart-section">
        <div className="chart-title">{t('asset_allocation')}</div>
        <div className="chart-card">
          {productPieFinal.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, fontSize: 13 }}>{t('no_data')}</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={productPieFinal} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={40} outerRadius={72} paddingAngle={2}>
                    {productPieFinal.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => (amountVisible ? fmt(Number(v)) + ' ' + primaryCurrency : '****')} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8 }}>
                {productPieFinal.map((d, i) => {
                  const total = productPieFinal.reduce((s, x) => s + x.value, 0);
                  return (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{d.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 4 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{masked(fmt(d.value))}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Institution Allocation Pie */}
      {institutionPieData.length > 1 && (
        <div className="chart-section">
          <div className="chart-title">{t('by_institution')}</div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={institutionPieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={40} outerRadius={72} paddingAngle={2}>
                  {institutionPieData.map((_, i) => <Cell key={i} fill={COLORS[(i + 6) % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => (amountVisible ? fmt(Number(v)) + ' ' + primaryCurrency : '****')} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 8 }}>
              {institutionPieData.map((d, i) => {
                const total = institutionPieData.reduce((s, x) => s + x.value, 0);
                return (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[(i + 6) % COLORS.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{d.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 4 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{masked(fmt(d.value))}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Currency Allocation Pie chart */}
      <div className="chart-section">
        <div className="chart-title">币种比例</div>
        <div className="chart-card">
          {currencyPieFinal.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, fontSize: 13 }}>{t('no_data')}</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={currencyPieFinal} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={40} outerRadius={72} paddingAngle={2}>
                    {currencyPieFinal.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => (amountVisible ? fmt(Number(v)) + ' ' + primaryCurrency : '****')} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8 }}>
                {currencyPieFinal.map((d, i) => {
                  const total = currencyPieFinal.reduce((s, x) => s + x.value, 0);
                  return (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[(i + 3) % COLORS.length], flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{d.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 4 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{masked(fmt(d.value))}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
