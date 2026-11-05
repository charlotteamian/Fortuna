export type BalanceFlowKind = 'buy' | 'sell';

export interface BalanceFlowConfig {
  increaseActionKey: string;
  decreaseActionKey: string;
  initialBalanceLabelKey: string;
  balanceLabelKey: string;
  totalIncreaseLabelKey: string;
  totalDecreaseLabelKey: string;
  transactionOnly: boolean;
}

export interface BalanceRecordLike {
  id: string;
  date: string;
  amount: number;
  createdAt: number;
  kind?: BalanceFlowKind;
  deltaAmount?: number;
}

export interface BalanceTimelineEntry {
  id: string;
  amount: number;
  underflow: boolean;
}

const DEBT_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'debt_lend_more',
  decreaseActionKey: 'debt_repayment_received',
  initialBalanceLabelKey: 'debt_initial_principal',
  balanceLabelKey: 'debt_outstanding',
  totalIncreaseLabelKey: 'debt_total_lent',
  totalDecreaseLabelKey: 'debt_total_repaid',
  transactionOnly: true,
};

const LOAN_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'loan_borrow_more',
  decreaseActionKey: 'loan_repay_principal',
  initialBalanceLabelKey: 'loan_initial_principal',
  balanceLabelKey: 'loan_outstanding',
  totalIncreaseLabelKey: 'loan_total_borrowed',
  totalDecreaseLabelKey: 'loan_total_repaid',
  transactionOnly: true,
};

const CREDIT_CARD_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'card_spend',
  decreaseActionKey: 'card_repay',
  initialBalanceLabelKey: 'card_initial_outstanding',
  balanceLabelKey: 'card_outstanding',
  totalIncreaseLabelKey: 'card_total_spend',
  totalDecreaseLabelKey: 'card_total_repaid',
  transactionOnly: true,
};

const DEPOSIT_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'deposit_in',
  decreaseActionKey: 'withdraw_out',
  initialBalanceLabelKey: 'initial_balance',
  balanceLabelKey: 'current_balance',
  totalIncreaseLabelKey: 'total_deposited',
  totalDecreaseLabelKey: 'total_withdrawn',
  transactionOnly: false,
};

const WEALTH_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'subscribe_in',
  decreaseActionKey: 'redeem_out',
  initialBalanceLabelKey: 'initial_investment',
  balanceLabelKey: 'current_balance',
  totalIncreaseLabelKey: 'total_subscribed',
  totalDecreaseLabelKey: 'total_redeemed',
  transactionOnly: false,
};

const GENERIC_BALANCE_FLOW: BalanceFlowConfig = {
  increaseActionKey: 'buy_in',
  decreaseActionKey: 'sell_out',
  initialBalanceLabelKey: 'initial_balance',
  balanceLabelKey: 'current_balance',
  totalIncreaseLabelKey: 'total_buy_amount',
  totalDecreaseLabelKey: 'total_sell_amount',
  transactionOnly: false,
};

const LOAN_CATEGORIES = new Set(['房贷', '车贷', '消费贷', '其他负债']);

export function getBalanceFlowConfig(category: string, type: 'asset' | 'liability'): BalanceFlowConfig {
  if (category === '债权' && type === 'asset') return DEBT_FLOW;
  if (category === '信用卡' && type === 'liability') return CREDIT_CARD_FLOW;
  if (type === 'liability' && LOAN_CATEGORIES.has(category)) return LOAN_FLOW;
  if (category === '银行存款') return DEPOSIT_FLOW;
  if (category === '理财产品') return WEALTH_FLOW;
  return GENERIC_BALANCE_FLOW;
}

export function usesDerivedBalanceRecords(category: string, type: 'asset' | 'liability'): boolean {
  return getBalanceFlowConfig(category, type).transactionOnly;
}

export function getBalanceFlowActionKey(config: BalanceFlowConfig, kind: BalanceFlowKind): string {
  return kind === 'buy' ? config.increaseActionKey : config.decreaseActionKey;
}

export function deriveBalanceTimeline(records: BalanceRecordLike[]): BalanceTimelineEntry[] {
  const chron = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let balance = 0;
  return chron.map(record => {
    let underflow = false;
    if (record.deltaAmount != null && record.kind) {
      const magnitude = Math.max(0, record.deltaAmount);
      const next = balance + (record.kind === 'buy' ? magnitude : -magnitude);
      underflow = next < -0.005;
      balance = Math.max(0, next);
    } else {
      // Legacy records remain valid balance snapshots and act as anchors for later deltas.
      balance = Math.max(0, record.amount);
    }
    balance = Math.round(balance * 100) / 100;
    return { id: record.id, amount: balance, underflow };
  });
}

export interface PortfolioNavInputPoint {
  date: string;
  totalValue: number;
  netFlow?: number;
}

export interface PortfolioNavSeriesPoint {
  date: string;
  nav: number;
  cumulativeReturnPercent: number;
  drawdownPercent: number;
}

export interface PortfolioNavSummary {
  series: PortfolioNavSeriesPoint[];
  latestNav: number;
  cumulativeReturnPercent: number;
  maxDrawdownPercent: number;
}

/**
 * Computes Time-Weighted Fund Unit NAV (starting at 1.0000) across a timeline of
 * portfolio valuations and external principal flows (deposits/withdrawals),
 * eliminating principal flow distortion from return & drawdown metrics.
 */
export function computePortfolioUnitNav(points: readonly PortfolioNavInputPoint[]): PortfolioNavSummary {
  const ordered = [...points]
    .filter(point => Number.isFinite(point.totalValue) && point.totalValue >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const series: PortfolioNavSeriesPoint[] = [];
  let shares = 0;
  let nav = 1.0;
  let peakNav = 1.0;
  let maxDrawdownPercent = 0;

  for (const point of ordered) {
    const totalValue = Math.max(0, point.totalValue);
    const netFlow = Number.isFinite(point.netFlow) ? (point.netFlow ?? 0) : 0;

    if (shares <= 0) {
      if (totalValue <= 0) continue;
      nav = 1.0;
      shares = totalValue / nav;
    } else {
      const preFlowValue = totalValue - netFlow;
      if (preFlowValue > 0) {
        nav = preFlowValue / shares;
      }
      const nextShares = shares + (nav > 0 ? netFlow / nav : 0);
      shares = nextShares > 0 ? nextShares : totalValue > 0 && nav > 0 ? totalValue / nav : 0;
    }

    const roundedNav = Math.round(nav * 10000) / 10000;
    if (roundedNav > peakNav) peakNav = roundedNav;
    const drawdownPercent = peakNav > 0 ? Math.round(((peakNav - roundedNav) / peakNav) * 10000) / 100 : 0;
    if (drawdownPercent > maxDrawdownPercent) maxDrawdownPercent = drawdownPercent;
    const cumulativeReturnPercent = Math.round((roundedNav - 1) * 10000) / 100;

    series.push({
      date: point.date,
      nav: roundedNav,
      cumulativeReturnPercent,
      drawdownPercent,
    });
  }

  const latest = series.at(-1);
  return {
    series,
    latestNav: latest?.nav ?? 1.0,
    cumulativeReturnPercent: latest?.cumulativeReturnPercent ?? 0,
    maxDrawdownPercent,
  };
}
