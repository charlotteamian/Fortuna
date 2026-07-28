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
