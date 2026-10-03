export interface DividendTrend {
  date: string; fetchedAt: number; rsi6: number; ma5Minor: number; ma10Minor: number; ma30Minor: number;
  bollLowerMinor: number; bollMiddleMinor: number; bollUpperMinor: number;
  change5: number; change10: number; change30: number;
}
export function parseDividendTrend(raw: unknown, code: string, now = Date.now()): DividendTrend {
  const source = raw as { data?: { code?: string; klines?: string[] } };
  const lines = source?.data?.klines;
  if (source?.data?.code !== code || !Array.isArray(lines) || lines.length < 31) throw new Error('TREND_SOURCE_INVALID');
  const rows = lines.map(line => {
    const cells = line.split(',');
    return { date: cells[0], close: Number(cells[2]) };
  }).sort((a,b) => a.date.localeCompare(b.date));
  if (rows.some(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(r.close) || r.close <= 0) || new Set(rows.map(r => r.date)).size !== rows.length) throw new Error('TREND_SOURCE_INVALID');
  const closes = rows.map(r => r.close), last = closes.at(-1)!;
  const mean = (period: number) => closes.slice(-period).reduce((sum,n) => sum+n, 0) / period;
  const middle = mean(20), deviation = Math.sqrt(closes.slice(-20).reduce((sum,n) => sum+(n-middle)**2,0)/20);
  // Wilder smoothing, seeded from the first six changes in the downloaded series.
  let gain = 0, loss = 0;
  for (let i=1;i<closes.length;i++) {
    const change = closes[i]-closes[i-1];
    if (i<=6) { gain += Math.max(change,0)/6; loss += Math.max(-change,0)/6; }
    else { gain = (gain*5+Math.max(change,0))/6; loss = (loss*5+Math.max(-change,0))/6; }
  }
  const change = (period: number) => (last / closes[closes.length-1-period]-1)*100;
  return { date: rows.at(-1)!.date, fetchedAt: now, rsi6: gain+loss === 0 ? 50 : loss === 0 ? 100 : 100-100/(1+gain/loss),
    ma5Minor: Math.round(mean(5)*100), ma10Minor: Math.round(mean(10)*100), ma30Minor: Math.round(mean(30)*100),
    bollLowerMinor: Math.round((middle-2*deviation)*100), bollMiddleMinor: Math.round(middle*100), bollUpperMinor: Math.round((middle+2*deviation)*100),
    change5: change(5), change10: change(10), change30: change(30) };
}

export function parseTencentDividendTrend(raw: unknown, code: string, symbol: string, now = Date.now()): DividendTrend {
  const source = raw as { code?: number; data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }> };
  const series = source?.data?.[symbol];
  const rows = series?.qfqday ?? series?.day;
  if (source?.code !== 0 || !Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length < 5)) throw new Error('TREND_SOURCE_INVALID');
  return parseDividendTrend({ data: { code, klines: rows.map(row => row.join(',')) } }, code, now);
}
