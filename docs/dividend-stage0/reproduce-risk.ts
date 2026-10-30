/** Stage 0 audit only. Synthetic inputs; no network or persistent database writes. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildDividendAdvisorContext, dividendAdvisorReadableSnapshot } from '../../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../../src/lib/dividendFundPlan.ts';
import { dividendResearchAdvice } from '../../src/lib/dividendResearchAdvice.ts';
import { dividendReviewSummary } from '../../src/lib/dividendReviewSummary.ts';
import { buildDividendHomePlan, type DividendStock } from '../../src/lib/dividendWorkbench.ts';
import { defaultDividendSelectionPrinciples, evaluateDividendResearch, parseDividendFinancialResearch, type DividendStockResearch } from '../../src/lib/dividendResearch.ts';
import { askDividendAdvisorWithActions } from '../../src/services/dividendAdvisorService.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && !specifier.endsWith('.ts')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const today = '2026-10-30';
const now = Date.parse(`${today}T03:00:00Z`);
const saved: DividendStock = {
  code: '000001', name: '模拟银行', group: 'core', weightBps: 10000,
  shareMode: 'manual', manualShares: 0, lotSize: 100, buyPaused: true,
  buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }],
  sellLevels: [{ priceMinor: 1200, yieldBps: 450, portionBps: 10000 }],
  quote: { priceMinor: 900, date: `${today} 10:00`, fetchedAt: now },
};
const riskStock: DividendStockResearch = { code: saved.code, name: saved.name,
  checks: [{ rule: 'roe', status: 'risk', value: 500, threshold: 800, period: '2025-12-31' },
    { rule: 'financialSector', status: 'unknown', reason: 'missing', period: '2026-09-30' }],
  status: 'risk', sources: [], issues: [],
};
const makeContext = (stock: DividendStock) => buildDividendAdvisorContext({
  stocks: [stock], strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true,
  fundPlan: defaultDividendFundPlan(), positions: new Map(),
  research: { generatedAt: now, principles: defaultDividendSelectionPrinciples(), stocks: [riskStock], indices: [] },
}, now);
const samples: unknown[] = [];

const advice = dividendResearchAdvice(riskStock, [], undefined, saved, today);
const home = buildDividendHomePlan(saved, 1000000, 0, today);
assert.equal(advice.decision, 'eligible');
assert.equal(home.buyState, 'paused');
assert.deepEqual(advice.failedRules, ['roe']);
assert.deepEqual(advice.missingRules, ['financialSector']);
const summary = dividendReviewSummary(riskStock, advice);
assert.ok(summary.risks.some(item => item.topic === 'roe'));
assert.ok(summary.missing.some(item => item.topic === 'financial_sector'));
samples.push({ id: 'R01', input: 'manual pause + ROE fail + sector evidence missing + quote 9.00 / saved buy 10.00',
  researchDecision: advice.decision, homeBuyState: home.buyState, priceTriggerLevels: advice.triggeredBuyLevels,
  failedRules: advice.failedRules, missingRules: advice.missingRules,
  interpretation: 'eligible is a price-only result; it cannot represent execution eligibility' });

for (const [id, date, quoteFailedAt] of [
  ['R02', '2026-10-29 15:00', undefined],
  ['R03', '2026-10-01 15:00', undefined],
  ['R04', `${today} 10:00`, now],
] as const) {
  const stock = { ...saved, buyPaused: false, quote: { ...saved.quote!, date }, quoteFailedAt };
  const localHome = buildDividendHomePlan(stock, 1000000, 0, today);
  const context = makeContext(stock);
  const quoteTouches = context.stockPlan.stocks[0].buyGrid[0].touched;
  const readable = dividendAdvisorReadableSnapshot(context);
  const readableTouch = readable['Active plan to discuss first']['Shares'][0]['Buy plan, cumulative holding targets'][0]['Saved quote reaches this price'];
  assert.equal(quoteTouches, true);
  assert.equal(readableTouch, true);
  if (id === 'R02') assert.equal(localHome.quoteUsable, true);
  else assert.equal(localHome.quoteUsable, false);
  samples.push({ id, quoteDate: date, latestRefreshFailed: quoteFailedAt !== undefined,
    homeQuoteUsable: localHome.quoteUsable, homeBuyState: localHome.buyState,
    aiSnapshotSavedQuoteReachesPrice: readableTouch });
}

// A transport stub is deliberately supplied: this never contacts an AI provider.
const unsafeAnswer = '模拟银行今天已到价，请立即新增买入100股。';
const aiResult = await askDividendAdvisorWithActions({ protocol: 'openai', baseUrl: 'https://model.example', model: 'audit-stub', apiKey: 'SYNTHETIC' },
  makeContext(saved), '今天优先做什么？', [], { language: 'zh', transport: async () => ({ status: 200,
    data: { choices: [{ message: { content: unsafeAnswer } }] } }) });
assert.equal(aiResult.answer, unsafeAnswer);
assert.deepEqual(aiResult.actions, []);
samples.push({ id: 'R05', input: 'manual pause and failed eligibility; stub prose proposes buying',
  returnedAnswer: aiResult.answer, persistentActions: aiResult.actions.length,
  interpretation: 'machine actions are constrained; displayed prose has no deterministic actionCheck guard' });

const row = { SECURITY_CODE: '000001', SECURITY_NAME_ABBR: '模拟银行', ORG_TYPE: '银行', REPORT_DATE: '2026-09-30', NOTICE_DATE: '2026-10-24',
  ROEJQ: 8, NET_INTEREST_MARGIN: 1.8, EPSJB: 2, NEWCAPITALADER: 13.5, HXYJBCZL: 10, NONPERLOAN: 1.2, BLDKBBL: 200 };
const financial = parseDividendFinancialResearch({ success: true, result: { data: [row, { ...row, REPORT_DATE: '2025-09-30', NOTICE_DATE: '2025-10-24' }] } }, '000001', today);
const missingBank = financial.sectorReview!.metrics.filter(metric => metric.status === 'unknown').map(metric => metric.key);
assert.ok(missingBank.includes('specialMentionLoans'));
assert.ok(missingBank.includes('overdue90DaysDeviation'));
assert.ok(missingBank.includes('internalCapitalCapacity'));
samples.push({ id: 'R06', input: 'ordinary bank provider feed, no separately verified bank report evidence',
  missingBankFields: missingBank, interpretation: 'production downloader currently passes no bankEvidence argument' });

const unknown = evaluateDividendResearch({ code: '000001', name: '模拟缺证', checks: [], status: 'pass', sources: [], issues: [] }, defaultDividendSelectionPrinciples(), now);
assert.equal(unknown.status, 'unknown');
assert.ok(unknown.checks.every(check => check.status === 'unknown'));
samples.push({ id: 'R07', input: 'no financial or dividend evidence', screening: unknown.status,
  interpretation: 'the existing numeric screen correctly preserves unknown instead of pass' });

console.log(JSON.stringify({ asOf: today, synthetic: true, networkUsed: false, persistentWrites: false, samples }, null, 2));
