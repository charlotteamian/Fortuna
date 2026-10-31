// Read-only reproduction against an archived baseline or the current source.
// Usage: node docs/dividend-stage1-1/reproduce.mjs /absolute/source/root
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const root = resolve(process.argv[2] ?? '.'), source = relative => import(pathToFileURL(`${root}/${relative}`).href);
const { dividendCheckSummary, dividendFundCheckSummary } = await source('src/lib/dividendCheckSummary.ts');
const { buildDividendAdvisorContext } = await source('src/lib/dividendAdvisor.ts');
const { defaultDividendFundPlan } = await source('src/lib/dividendFundPlan.ts');
const { calculateDividendPricing, defaultDividendPricingMethod } = await source('src/lib/dividendPricing.ts');
const { dividendPricingPlan, dividendPricingProvenance } = await source('src/lib/dividendPricingPlan.ts');
const { askDividendAdvisorWithActions } = await source('src/services/dividendAdvisorService.ts');
const { pingAnOfficialLedger } = await source('scripts/helpers/dividendPricingFixture.ts');
const asOf = '2026-10-30', now = Date.parse(`${asOf}T03:00:00Z`);
const ledger = pingAnOfficialLedger(asOf), method = defaultDividendPricingMethod();
const pricing = calculateDividendPricing({ code: '000001', name: 'Synthetic bank', asOf, ledger, method, financialSector: true,
  annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 2030000, payoutBps: 3000, dividendMicros: 609000 }], priceMinor: 900, priceDate: `${asOf} 10:00` });
const stock = { code: '000001', name: 'Synthetic bank', group: 'core', weightBps: 10000, shareMode: 'manual', manualShares: 200, lotSize: 100,
  ...dividendPricingPlan(pricing), gridProvenance: dividendPricingProvenance(pricing, now - 1000), quote: { priceMinor: 900, date: `${asOf} 10:00`, fetchedAt: now } };
const research = { code: stock.code, name: stock.name, status: 'pass', checks: [{ rule: 'roe', status: 'pass', value: 1000, threshold: 800, period: '2025-12-31' }], sources: [], issues: [], pricing };
const summarize = patch => dividendCheckSummary({ stock, research, totalBudgetMinor: 1000000, researchGeneratedAt: now, asOf, now, ...patch });
const fund = { id: 'synthetic', name: '模拟基金', code: '512890', indexKind: 'low_volatility', weightBps: 10000,
  quote: { priceMicros: 1200000, date: `${asOf} 10:00`, fetchedAt: now }, reference: { asOf, highMicros: 1200000, indexYieldBps: 550, priceMicros: 1000000 } };
const fundPlan = { ...defaultDividendFundPlan(), mode: 'swing', budgetMinor: 1000000, funds: [fund] };
const manualFund = { ...fund, quote: undefined };
const context = buildDividendAdvisorContext({ stocks: [], strategy: 'funds', budgetMinor: 0, budgetConfigured: false, positions: new Map(),
  fundPositions: new Map([[fund.code, 500]]), fundPlan: { ...fundPlan, funds: [manualFund] } }, now);
const unsafe = '今天已到价，请立即新增买入100份。';
const answer = await askDividendAdvisorWithActions({ protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'stub', apiKey: 'synthetic-key' }, context,
  '重新生成基金计划并告诉我今天怎么操作？', [], { transport: async () => ({ status: 200, data: { choices: [{ message: { content: unsafe } }] } }) });
const missingTier = summarize({ stock: { ...stock, buyLevels: [{ yieldBps: 550, portionBps: 2500 }, { yieldBps: 575, portionBps: 7500, priceMinor: 1000 }] } });
const oldSpecial = { ...ledger.events[0], id: 'old-special', batchId: 'old-special', period: 'special', reportDate: '2019-12-31', announcementDate: '2020-05-01', exDate: '2020-06-01', shareFactor: 1, implemented: true };
const historical = summarize({ ledger: { ...ledger, events: [...ledger.events, oldSpecial] } });
console.log(JSON.stringify({ environment: 'synthetic/fake-indexeddb, archived arithmetic fixture, local transport stub; no external calls or real data',
  ai: { unsafePreserved: answer.answer.includes(unsafe), action: context.fundPlan.funds[0].checkSummary.actionCheck.buy.status, answer: answer.answer },
  fund: { held500: dividendFundCheckSummary({ plan: fundPlan, fund, shares: 500, asOf, now }).actionCheck.sell,
    omittedShares: dividendFundCheckSummary({ plan: fundPlan, fund, asOf, now }).actionCheck },
  next: { tierIndices: missingTier.grid.buyTierIndices, nextBuy: missingTier.grid.nextBuy, nextBuyState: missingTier.grid.nextBuyState },
  unrelatedOldSpecialBlocked: historical.actionCheck.buy.reasons.includes('special_dividend_review') }, null, 2));
