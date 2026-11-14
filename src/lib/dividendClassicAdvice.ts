import type { ClassicGridTierRow, ClassicStockPlan } from './dividendClassicStrategy.ts';
import { dividendQuoteUsability } from './dividendQuoteUsability.ts';
import { dateInChina } from './dividendWorkbench.ts';

type ClassicAdviceStatus = 'buy' | 'sell' | 'waiting' | 'paused' | 'no_budget' | 'covered' | 'below_lot' | 'quote_unverified' | 'reference_only' | 'no_base';

export function getClassicAdviceFacts(plan: ClassicStockPlan, asOf: string, now = Date.now()) {
  const latestExDate = plan.base.latestExDate && plan.base.latestExDate <= asOf ? plan.base.latestExDate : undefined;
  const quoteCurrent = plan.quoteSource === 'live' && !!plan.quoteDate && dividendQuoteUsability({
    quote: { date: plan.quoteDate, priceMinor: plan.quotePriceMinor },
    latestExDate, asOf, now,
  }).status === 'current';
  const action = plan.todayAction;
  const buy1 = plan.buyRows[0];
  const sell1 = plan.shares > 0 ? plan.sellRows[0] : undefined;
  const touchedBuyLevel = quoteCurrent ? action.triggeredBuyLevel : 0;
  const touchedSellLevel = quoteCurrent && sell1 ? action.triggeredSellLevel : 0;
  const buyGap = buy1?.gapFromQuoteBps;
  const buy1GapBps = quoteCurrent && !buy1?.touched && buyGap !== undefined ? Math.abs(buyGap) : undefined;
  const sell1GapBps = quoteCurrent && sell1 && !sell1.touched ? sell1.gapFromQuoteBps : undefined;
  const impliedYield = (row?: ClassicGridTierRow) => row && plan.base.netDpsMicros !== undefined && row.priceMinor > 0 ? Math.round(plan.base.netDpsMicros / row.priceMinor) : undefined;
  let status: ClassicAdviceStatus = 'waiting';
  if (action.type === 'unavailable') status = 'no_base';
  else if (!quoteCurrent) status = 'quote_unverified';
  else if (plan.base.tier !== 'recent_batches') status = 'reference_only';
  else if (action.type === 'sell') status = 'sell';
  else if (plan.buyPaused) status = 'paused';
  else if (!plan.budgetMinor) status = 'no_budget';
  else if (action.type === 'buy' && action.suggestedShares > 0) status = 'buy';
  else if (touchedBuyLevel || touchedSellLevel) {
    status = plan.buyRows[touchedBuyLevel - 1]?.status === 'covered' ? 'covered' : 'below_lot';
  }
  const actionable = status === 'buy' || status === 'sell';
  return {
    status, quoteCurrent, buy1, sell1, buy1GapBps, sell1GapBps,
    buy1ImpliedYieldBps: impliedYield(buy1), sell1ImpliedYieldBps: impliedYield(sell1),
    touchedBuyLevel, touchedSellLevel,
    shares: actionable ? action.suggestedShares : 0,
    amountMinor: actionable ? action.suggestedAmountMinor : undefined,
  };
}

const nameOf = (plan: ClassicStockPlan, zh: boolean) =>
  `${plan.name.replace(/[\\`*_{}[\]<>#|\r\n]/g, '')}${zh ? `（${plan.code}）` : ` (${plan.code})`}`;
const yuan = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toFixed(2)}`;
const pct = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;
const pullback = (bps: number) => bps === 0 ? '<0.01%' : pct(bps);

export function scopeClassicAdvicePlans(plans: ClassicStockPlan[], selectedCode?: string): ClassicStockPlan[] {
  return selectedCode
    ? plans.filter(plan => plan.code === selectedCode)
    : plans.filter(plan => plan.group !== 'hidden' || plan.shares > 0);
}

function tierText(plan: ClassicStockPlan, row: ClassicGridTierRow, impliedYield: number | undefined, zh: boolean): string {
  const classicLevels = row.side === 'buy' ? plan.classicBuyLevels : plan.classicSellLevels;
  const saved = plan.gridOrigin === 'custom_saved' || row.yieldBps !== classicLevels[row.level - 1]?.yieldBps;
  const tier = row.side === 'buy' ? (zh ? '买' : 'Buy ') : (zh ? '卖' : 'Sell ');
  const operator = row.side === 'buy' ? '≤' : '≥';
  const yieldLabel = saved ? (zh ? '按保存价折算税后股息率' : 'implied net yield at saved price') : (zh ? '目标税后股息率' : 'target net yield');
  return `${tier}${row.level} ${operator} **${yuan(row.priceMinor)}** · ${yieldLabel} ${pct(saved ? impliedYield : row.yieldBps)}`;
}

function statusText(plan: ClassicStockPlan, facts: ReturnType<typeof getClassicAdviceFacts>, zh: boolean): string {
  switch (facts.status) {
    case 'buy':
    case 'sell': {
      const buy = facts.status === 'buy';
      const row = buy ? plan.buyRows[facts.touchedBuyLevel - 1] : plan.sellRows[facts.touchedSellLevel - 1];
      const yieldAtPrice = row && plan.base.netDpsMicros !== undefined && row.priceMinor > 0 ? Math.round(plan.base.netDpsMicros / row.priceMinor) : undefined;
      const quantity = zh ? `网格数量 ${facts.shares} 股` : `Grid quantity ${facts.shares} shares`;
      return `${tierText(plan, row, yieldAtPrice, zh)} · ${quantity}`;
    }
    case 'paused': return facts.touchedBuyLevel ? (zh ? '已触及买档 · 已暂停买入' : 'Buy tier touched · buying paused')
      : (zh ? '已暂停买入' : 'Buying paused');
    case 'no_budget': return facts.touchedBuyLevel ? (zh ? '已触及买档 · 未分配预算' : 'Buy tier touched · no budget assigned')
      : (zh ? '仅观察 · 未分配预算' : 'Watch only · no budget assigned');
    case 'covered': return zh ? '已触及买档 · 持仓已覆盖本档目标' : 'Buy tier touched · current holdings cover this tier';
    case 'below_lot': return zh ? '已触及网格 · 本档数量不足一手' : 'Tier touched · quantity below one lot';
    case 'reference_only': return zh ? '按已保存网格 · 分红基数未核对，仅参考' : 'Saved grid · dividend basis unchecked, reference only';
    case 'no_base': return zh ? '无已核验分红基数 · 无法判断' : 'No verified dividend basis · cannot judge';
    case 'quote_unverified': return zh ? '缺少当日有效行情' : 'Current-day quote unavailable';
    case 'waiting': return zh ? '等待触价' : 'Waiting for a price trigger';
  }
}

export function buildClassicDailyAdviceMarkdown(
  plans: ClassicStockPlan[],
  options: { selectedCode?: string; language?: string; asOf?: string; now?: number } = {},
): string {
  const zh = (options.language ?? 'zh').startsWith('zh');
  const now = options.now ?? Date.now();
  const asOf = options.asOf ?? dateInChina(new Date(now));
  const rows = scopeClassicAdvicePlans(plans, options.selectedCode)
    .map(plan => ({ plan, facts: getClassicAdviceFacts(plan, asOf, now) }));
  if (!rows.length) return zh ? '暂无可查看的股票网格。' : 'No stock grid to review.';
  const lines: string[] = [];

  if (options.selectedCode) {
    const { plan, facts } = rows[0];
    const quoteLabel = facts.quoteCurrent ? (zh ? '当日报价' : 'Current-day quote') : (zh ? '未核验报价' : 'Unverified quote');
    lines.push(`### ${nameOf(plan, zh)}`, '', statusText(plan, facts, zh), '',
      `- ${quoteLabel} ${yuan(plan.quotePriceMinor)}${plan.quoteDate ? ` · ${plan.quoteDate}` : ''}`);
    if (facts.buy1) lines.push(`- ${tierText(plan, facts.buy1, facts.buy1ImpliedYieldBps, zh)}${facts.buy1GapBps === undefined ? '' : zh ? ` · 再回落 ${pullback(facts.buy1GapBps)}` : ` · ${pullback(facts.buy1GapBps)} lower`}`);
    if (facts.sell1) lines.push(`- ${tierText(plan, facts.sell1, facts.sell1ImpliedYieldBps, zh)}${facts.sell1GapBps === undefined ? '' : zh ? ` · 再上涨 ${pullback(facts.sell1GapBps)}` : ` · ${pullback(facts.sell1GapBps)} higher`}`);
    if (plan.base.cappedAtEarnings || plan.base.tier !== 'recent_batches') lines.push(`- ${zh ? plan.base.strategyNoteZh : plan.base.strategyNoteEn}`);
    return lines.join('\n');
  }

  const buys = rows.filter(({ facts }) => facts.status === 'buy');
  const sells = rows.filter(({ facts }) => facts.status === 'sell');
  const watch = rows.filter(({ facts }) => facts.status === 'waiting' && facts.buy1GapBps !== undefined)
    .sort((a, b) => a.facts.buy1GapBps! - b.facts.buy1GapBps! || a.plan.code.localeCompare(b.plan.code));
  const other = rows.filter(row => !buys.includes(row) && !sells.includes(row) && !watch.includes(row));
  lines.push(zh
    ? `**${asOf} · 网格数量可计算：买 ${buys.length} 只，卖 ${sells.length} 只**`
    : `**${asOf} · Calculated grid quantities: ${buys.length} buy, ${sells.length} sell**`);
  if (buys.length || sells.length) {
    lines.push('', zh ? '### 已触价' : '### Price triggers');
    for (const { plan, facts } of [...buys, ...sells]) {
      const basisNote = plan.base.cappedAtEarnings ? (zh ? ' · 基数已按每股收益封顶' : ' · Base limited to annual EPS') : '';
      lines.push(`- **${nameOf(plan, zh)}** · ${statusText(plan, facts, zh)}${basisNote}`);
    }
  }
  if (watch.length) {
    lines.push('', zh ? '### 距买1最近（已分配预算）' : '### Nearest to Buy 1 (budget assigned)');
    for (const { plan, facts } of watch.slice(0, 6)) {
      const lotNote = facts.buy1?.targetShares === 0 ? (zh ? ' · 买1预算不足一手' : ' · Buy 1 budget below one lot') : '';
      const distance = zh ? `再回落 **${pullback(facts.buy1GapBps!)}**` : `**${pullback(facts.buy1GapBps!)}** lower`;
      lines.push(`- **${nameOf(plan, zh)}** · ${yuan(plan.quotePriceMinor)} → ${yuan(facts.buy1?.priceMinor)} · ${distance}${lotNote}`);
    }
    if (watch.length > 6) lines.push(zh ? `- 显示距离最近的 6 只，共 ${watch.length} 只等待买档。`
      : `- Showing the nearest 6 of ${watch.length} stocks waiting for a buy tier.`);
  }
  if (other.length) {
    lines.push('', zh ? '### 其他状态' : '### Other statuses');
    for (const { plan, facts } of other) lines.push(`- **${nameOf(plan, zh)}** · ${statusText(plan, facts, zh)}`);
  }
  return lines.join('\n');
}
