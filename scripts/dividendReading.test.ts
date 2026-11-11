import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ts from 'typescript';
import { dividendCheckSummary, dividendFundCheckSummary, type DividendCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendStocks } from '../src/lib/dividendWorkbench.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { dividendHomeCollapsed, matchesDividendReadFilter } from '../src/lib/dividendReading.ts';
import { dividendCheckZh, dividendCheckEn } from '../src/i18n/dividendCheckTranslations.ts';
import { dividendHomeZh, dividendHomeEn } from '../src/i18n/dividendHomeTranslations.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) for (const extension of ['.ts', '.tsx']) {
      const url = new URL(specifier + extension, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText };
    return nextLoad(url, context);
  },
});
const { default: CompactPlan } = await import('../src/components/DividendCompactPlan.tsx');
const i18n = createInstance();
await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: {
  zh: { translation: { ...dividendCheckZh, ...dividendHomeZh } }, en: { translation: { ...dividendCheckEn, ...dividendHomeEn } },
}, interpolation: { escapeValue: false } });
const asOf = '2026-11-01', now = Date.parse('2026-11-01T03:00:00Z');
const stock = { ...defaultDividendStocks()[0], weightBps: 10000, buyPaused: true,
  buyLevels: [1000, 800, 600, 500].map(priceMinor => ({ priceMinor, yieldBps: 550, portionBps: 2500 })),
  sellLevels: [1200, 1400, 1600, 1800].map(priceMinor => ({ priceMinor, yieldBps: 480, portionBps: 2500 })),
  quote: { priceMinor: 500, date: `${asOf} 10:00`, fetchedAt: now } };
const summary = (shares = 500) => dividendCheckSummary({ stock, totalBudgetMinor: 1000000, shares, asOf, now });
const render = (value: DividendCheckSummary, amountVisible = true) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(CompactPlan, { summary: value, amountVisible })));

test('compact targets show original holding target and price status without redundant touch commentary', () => {
  const value = summary(), html = render(value);
  assert.equal(value.grid.nextBuy?.index, 3);
  assert.match(html, /原第3档/); assert.match(html, /到价/);
  assert.match(html, new RegExp(`累计持仓目标 ${value.grid.nextBuy!.targetShares!.toLocaleString('zh')} 股`));
  assert.doesNotMatch(html, /最深触价|本轮累计差额|本轮累计卖出/);
  assert.match(html, /手动暂停新增买入/); assert.doesNotMatch(html, /已成交|已执行|<table/);
});

test('a partial original tier is explicitly a price reference and does not invent share targets or differences', () => {
  const value = dividendCheckSummary({ stock: { ...stock, buyLevels: stock.buyLevels.map((level, index) => index === 1 ? level : { ...level, priceMinor: undefined }) }, totalBudgetMinor: 1000000, shares: 0, asOf, now });
  const targets = render(value).split('<dl class="div-check-status-main">')[0];
  assert.match(targets, /原第2档/); assert.match(targets, /仅价格参考/);
  assert.doesNotMatch(targets, /累计持仓目标|本轮累计差额/);
});

test('covered targets, no holdings, unknown budgets and below-lot differences remain separate', () => {
  assert.match(render(summary(10000)), /全部目标已覆盖/);
  assert.match(render(summary(0)), /无持仓/);
  assert.match(render(dividendCheckSummary({ stock, shares: 0, asOf, now })), /目标股数待核实/);
  assert.match(render(summary(150)), /差额不足整手/);
});

test('stale quotes retain source time without a current deepest touch or fabricated transaction', () => {
  const html = render(dividendCheckSummary({ stock: { ...stock, quote: { ...stock.quote, date: '2026-10-28 15:00', fetchedAt: Date.parse('2026-10-28T07:00:00Z') } }, totalBudgetMinor: 1000000, shares: 0, asOf, now }));
  assert.match(html, /2026-10-28 15:00/); assert.match(html, /行情待核实/);
  assert.doesNotMatch(html, /最深触价|已成交/);
});

test('compact reading keeps actionable problems and one data-date location without evidence disclosures', () => {
  const html = render(summary());
  const primary = html.match(/<ul class="div-check-primary-reasons">(.*?)<\/ul>/s)![1];
  assert.ok((primary.match(/<li/g) ?? []).length <= 3);
  assert.equal((html.match(/class="div-check-data-date"/g) ?? []).length, 1);
  assert.match(html, /数据更新：行情 2026-11-01 10:00/);
  assert.doesNotMatch(html, /查看全部依据|检查生成|研究生成|<details|价格依据/);
});

test('zero holdings with an expensive stock retains tier one and explains the lot constraint without zero-share targets', () => {
  const html = render(dividendCheckSummary({ stock: { ...stock, buyPaused: false,
    buyLevels: [12554, 12008, 11508, 10623].map(priceMinor => ({ priceMinor, yieldBps: 550, portionBps: 2500 })),
    quote: { priceMinor: 24713, date: `${asOf} 10:00`, fetchedAt: now } }, totalBudgetMinor: 2083000, shares: 0, asOf, now }));
  assert.match(html, /原第1档 · ¥125.54/);
  assert.match(html, /该档预算不足 1 手/);
  assert.match(html, /未到价/);
  assert.doesNotMatch(html, /原第3档|累计持仓目标 0 股|最深触价/);
});

test('the next tier does not inherit a price touch from an earlier covered tier', () => {
  const buy = render(dividendCheckSummary({ stock: { ...stock, quote: { ...stock.quote, priceMinor: 900 } }, totalBudgetMinor: 1000000, shares: 500, asOf, now }));
  assert.match(buy, /原第3档 · ¥6<\/span><small>累计持仓目标 [\d,]+ 股<\/small><small>未到价/);
  const sell = render(dividendCheckSummary({ stock: { ...stock, quote: { ...stock.quote, priceMinor: 1400 } }, totalBudgetMinor: 1000000, shares: 100, asOf, now }));
  assert.match(sell, /原第4档 · ¥18<\/span><small>累计卖出目标 100 股<\/small><small>未到价/);
});

test('manual amount masking preserves public stock prices and the chosen tier without exposing monetary or share amounts', () => {
  const html = render(summary(), false);
  assert.match(html, /¥5/); assert.match(html, /原第3档/); assert.match(html, /••••/);
  assert.doesNotMatch(html, /¥10,000|500 股|1,200 股/);
});

test('fund summaries retain their own entry/exit references and distinguish unknown from confirmed zero holdings', () => {
  const plan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, mode: 'swing' as const, funds: [] };
  const fund = { id: 'manual', name: 'Synthetic manual fund', indexKind: 'other' as const, weightBps: 10000, reference: { priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, asOf } };
  const unknown = dividendFundCheckSummary({ plan, fund, asOf, now });
  const zero = dividendFundCheckSummary({ plan, fund, shares: 0, asOf, now });
  assert.match(render(unknown), /手工参考价/); assert.match(render(unknown), /¥1/);
  assert.match(render(unknown), /持仓尚未确认/); assert.match(render(zero), /已持仓 0 股/);
  assert.match(render(unknown), /入场价格参考|退出价格参考/); assert.doesNotMatch(render(unknown), /原第|累计持仓目标/);
  assert.doesNotMatch(render(unknown, false), /¥1/); assert.match(render(unknown, false), /••••/);
});

test('reading filters keep observed touch, holdings, pause and unknown data independent and immutable', () => {
  const value = summary(), before = structuredClone(value);
  assert.equal(matchesDividendReadFilter(value, 'triggered'), true);
  assert.equal(matchesDividendReadFilter(value, 'paused'), true);
  assert.equal(matchesDividendReadFilter(value, 'held'), true);
  assert.equal(matchesDividendReadFilter(value, 'unknown'), true);
  assert.equal(matchesDividendReadFilter(undefined, 'unknown'), true);
  assert.equal(matchesDividendReadFilter(undefined, 'held'), false);
  assert.deepEqual(value, before);
});

test('fund and explicit stock reading preferences restore independently without interpreting absence as stock expansion', () => {
  assert.equal(dividendHomeCollapsed('600036', ['600036']), true);
  assert.equal(dividendHomeCollapsed('600036', []), false);
  assert.equal(dividendHomeCollapsed('fund:one', []), true);
  assert.equal(dividendHomeCollapsed('fund:one', ['open:fund:one']), false);
  assert.equal(dividendHomeCollapsed('fund:two', ['open:fund:one']), true);
});
