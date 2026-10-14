import { db, initializeSettings, updateSettings } from '../db';
import { defaultDividendFundPlan, isDividendFund, isDividendFundPlan, type DividendFund, type DividendFundPlan, type DividendStrategy } from '../lib/dividendFundPlan';
import { requestPortableSnapshot } from './portableSnapshotEvents';

export async function saveDividendStrategy(strategy: DividendStrategy) {
  if (!['stocks', 'funds'].includes(strategy)) throw new Error('INVALID_DIVIDEND_STRATEGY');
  await updateSettings({ dividendStrategy: strategy });
  requestPortableSnapshot('dividend-strategy');
}

async function editPlan(edit: (current: DividendFundPlan) => DividendFundPlan) {
  await initializeSettings();
  await db.transaction('rw', db.settings, async () => {
    const settings = await db.settings.get('main');
    const plan = edit(settings?.dividendFundPlan ?? defaultDividendFundPlan());
    if (plan.funds.reduce((sum, fund) => sum + fund.weightBps, 0) > 10000) throw new Error('DIVIDEND_FUND_OVERWEIGHT');
    const codes = plan.funds.flatMap(fund => fund.code ? [fund.code] : []);
    if (new Set(codes).size !== codes.length) throw new Error('DIVIDEND_FUND_DUPLICATE');
    if (!isDividendFundPlan(plan)) throw new Error('INVALID_DIVIDEND_FUND_PLAN');
    await db.settings.update('main', { dividendFundPlan: plan });
  });
  requestPortableSnapshot('dividend-fund-plan');
}

export async function saveDividendFundConfig(config: Omit<DividendFundPlan, 'funds'>) {
  if (!isDividendFundPlan({ ...config, funds: [] })) throw new Error('INVALID_DIVIDEND_FUND_PLAN');
  await editPlan(current => ({ ...config, funds: current.funds }));
}
export async function saveDividendFund(fund: DividendFund) {
  if (!isDividendFund(fund)) throw new Error('INVALID_DIVIDEND_FUND');
  await editPlan(current => {
    const previous = current.funds.find(row => row.id === fund.id);
    const saved = { ...fund };
    delete saved.quote; delete saved.quoteFailedAt;
    if (previous?.code === fund.code) {
      if (previous?.quote) saved.quote = previous.quote;
      if (previous?.quoteFailedAt !== undefined) saved.quoteFailedAt = previous.quoteFailedAt;
    }
    return { ...current, funds: [...current.funds.filter(row => row.id !== fund.id), saved] };
  });
}
export async function deleteDividendFund(id: string) {
  await editPlan(current => ({ ...current, funds: current.funds.filter(fund => fund.id !== id) }));
}
