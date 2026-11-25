import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClassicDailyAdviceMarkdown, getClassicAdviceFacts } from '../src/lib/dividendClassicAdvice.ts';
import { buildClassicStockPlan, type ClassicVerifiedBasis } from '../src/lib/dividendClassicStrategy.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { clearDividendAdvisorConfig, saveDividendAdvisorConfig } from '../src/services/dividendAdvisorService.ts';
import { generateClassicDividendAdvice } from '../src/services/dividendClassicAdvisorService.ts';

const asOf = '2026-11-04';
const now = Date.parse('2026-11-04T09:35:00+08:00');
const verifiedBasis: ClassicVerifiedBasis = {
  dpsMicros: 4_300_000, implementedDpsMicros: 4_300_000, verified: true,
  frequency: 'annual', reportPeriods: ['2025-12-31'], latestExDate: '2026-07-10',
};
const makePlan = (overrides: Partial<DividendStock> = {}, totalBudgetMinor = 10_000_000) => buildClassicStockPlan({
  code: '000333', name: '美的集团', group: 'core', weightBps: 1500, lotSize: 100, shareMode: 'manual', manualShares: 0,
  quote: { priceMinor: 8888, date: '2026-11-04 09:32' },
  buyLevels: [{ priceMinor: 7818, yieldBps: 550, portionBps: 2500 }],
  sellLevels: [{ priceMinor: 8958, yieldBps: 480, portionBps: 2500 }],
  ...overrides,
}, { totalBudgetMinor, asOf, basis: 'basis' in overrides ? overrides.basis : verifiedBasis });

test('saved screenshot prices keep their actual gap and implied net yield, with sell monitoring limited to holdings', () => {
  const watch = makePlan();
  const facts = getClassicAdviceFacts(watch, asOf, now);
  assert.equal(facts.buy1GapBps, 1204);
  assert.equal(facts.sell1, undefined);
  const watchReport = buildClassicDailyAdviceMarkdown([watch], { selectedCode: watch.code, asOf, now });
  assert.match(watchReport, /买1 ≤ \*\*¥78\.18\*\* · 按保存价折算税后股息率 4\.95% · 再回落 12\.04%/);
  assert.doesNotMatch(watchReport, /卖1|4\.80%/);

  const held = makePlan({ manualShares: 1000 });
  const heldReport = buildClassicDailyAdviceMarkdown([held], { selectedCode: held.code, asOf, now });
  assert.match(heldReport, /卖1 ≥ \*\*¥89\.58\*\* · 按保存价折算税后股息率 4\.32% · 再上涨 0\.79%/);
});

test('watchlist ranks funded, unpaused names with current quotes by remaining pullback and keeps sell rows out', () => {
  const farther = makePlan();
  const closer = makePlan({ code: '600011', name: '华能国际', buyLevels: [{ priceMinor: 8700, yieldBps: 550, portionBps: 2500 }] });
  const noBudget = makePlan({ code: '000001', name: '预算为零', weightBps: 0 });
  const paused = makePlan({ code: '000002', name: '手动暂停', buyPaused: true });
  const reference = makePlan({ code: '600900', name: '只有参考价', quote: undefined });
  const baseline = makePlan({ code: '601288', name: '只有参考股息', buyLevels: undefined, sellLevels: undefined, basis: undefined });
  const markdown = buildClassicDailyAdviceMarkdown([farther, noBudget, paused, reference, baseline, closer], { asOf, now });
  const [, ranked, other] = markdown.split(/### 距买1最近（已分配预算）|### 其他状态/);
  assert.ok(ranked.indexOf('华能国际') < ranked.indexOf('美的集团'));
  assert.doesNotMatch(ranked, /卖1|预算为零|手动暂停|只有参考价|只有参考股息/);
  assert.match(other, /预算为零.*未分配预算/);
  assert.match(other, /手动暂停.*暂停买入/);
  assert.match(other, /只有参考价.*缺少当日有效行情/);
  assert.match(other, /只有参考股息.*无已核验分红基数/);
});

test('potential price touches cannot report sell without holdings or buy without budget, time or lots', () => {
  const sellQuote = { priceMinor: 9000, date: '2026-11-04 09:32' };
  const buyQuote = { priceMinor: 7700, date: '2026-11-04 09:32' };
  const unheld = getClassicAdviceFacts(makePlan({ quote: sellQuote }), asOf, now);
  assert.equal(unheld.touchedSellLevel, 0);
  assert.equal(unheld.status, 'waiting');
  assert.equal(getClassicAdviceFacts(makePlan({ quote: sellQuote, manualShares: 1000, buyPaused: true, weightBps: 0 }), asOf, now).shares, 200);
  const baseline = getClassicAdviceFacts(makePlan({ quote: sellQuote, manualShares: 1000, buyLevels: undefined, sellLevels: undefined, basis: undefined }), asOf, now);
  assert.equal(baseline.status, 'no_base');
  assert.equal(baseline.shares, 0);
  assert.equal(getClassicAdviceFacts(makePlan({ quote: buyQuote, weightBps: 0 }), asOf, now).status, 'no_budget');
  assert.equal(getClassicAdviceFacts(makePlan({ quote: buyQuote }), asOf, now).status, 'below_lot');
  assert.equal(getClassicAdviceFacts(makePlan({ quote: buyQuote, weightBps: 10000 }), asOf, now).status, 'buy');

  for (const date of ['2026-11-03 09:32', '2026-11-04', '2026-11-04 09:36', '2026-11-05 09:32']) {
    const facts = getClassicAdviceFacts(makePlan({ quote: { ...buyQuote, date }, weightBps: 10000 }), asOf, now);
    assert.equal(facts.status, 'quote_unverified');
    assert.equal(facts.touchedBuyLevel, 0);
    assert.equal(facts.shares, 0);
  }
});

test('daily check stays local while custom AI questions call the configured provider with structured context and honest errors', async () => {
  await saveDividendAdvisorConfig({ protocol: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'synthetic-secret', model: 'synthetic' });
  try {
    const plans = [makePlan(), makePlan({ code: '000001', name: '其他股票' })];
    const base = { plans, selectedCode: plans[0].code, asOf };
    let sent = false;
    const local = await generateClassicDividendAdvice({ ...base, transport: async () => {
      sent = true;
      return { status: 500, data: null };
    } });
    assert.equal(sent, false);
    assert.match(local.localMarkdown, /美的集团/);

    const markdownReply = '### 美的集团解读\n\n当前报价 ¥88.88 距买1（¥78.18）还有 12.04% 空间，暂无触发，耐心等待即可。';
    let requestBody = '';
    const accepted = await generateClassicDividendAdvice({ ...base, question: '美的集团现在需要操作吗？', transport: async request => {
      requestBody = JSON.stringify(request.body);
      return { status: 200, data: { choices: [{ message: { content: markdownReply } }] } };
    } });
    assert.match(requestBody, /美的集团/);
    assert.doesNotMatch(requestBody, /其他股票/);
    assert.equal(accepted.explanationStatus, 'complete');
    assert.equal(accepted.modelMarkdown, markdownReply);
    assert.equal(accepted.localMarkdown, local.localMarkdown);

    // Provider HTTP failure surfaces explicit failure details without leaking API key.
    const httpFailed = await generateClassicDividendAdvice({ ...base, question: '解释一下收益率', transport: async () => ({
      status: 401, data: JSON.stringify({ error: { code: 'invalid_api_key', message: 'Bad key synthetic-secret' } }),
    }) });
    assert.equal(httpFailed.explanationStatus, 'unavailable');
    assert.equal(httpFailed.errorCode, 'AUTH');
    assert.equal(httpFailed.httpStatus, 401);
    assert.equal(httpFailed.modelMarkdown, undefined);
    assert.match(httpFailed.errorMessage ?? '', /HTTP 401|认证失败/);
    assert.doesNotMatch(httpFailed.errorMessage ?? '', /synthetic-secret/);

    // Network exception surfaces clear network failure.
    const netFailed = await generateClassicDividendAdvice({ ...base, question: '今天做什么？', transport: async () => {
      throw new Error('Failed to fetch');
    } });
    assert.equal(netFailed.explanationStatus, 'unavailable');
    assert.equal(netFailed.errorCode, 'NETWORK');
    assert.match(netFailed.errorMessage ?? '', /网络异常|无法连接/);
  } finally {
    await clearDividendAdvisorConfig();
  }

  // Unconfigured AI reports explicit setup message.
  const unconfigured = await generateClassicDividendAdvice({ plans: [makePlan()], asOf, question: '今天做什么？' });
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.explanationStatus, 'unconfigured');
  assert.equal(unconfigured.errorCode, 'CONFIG');
  assert.match(unconfigured.errorMessage ?? '', /尚未配置 AI/);
});
