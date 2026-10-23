import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ts from 'typescript';
import { defaultDividendStocks } from '../src/lib/dividendWorkbench.ts';
import { dividendHomeZh, dividendHomeEn } from '../src/i18n/dividendHomeTranslations.ts';
import { dividendGridZh, dividendGridEn } from '../src/i18n/dividendGridTranslations.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
    return nextLoad(url, context);
  },
});
const { default: DividendHomePlan } = await import('../src/components/DividendHomePlan.tsx');
const { default: DividendPlanGrid } = await import('../src/components/DividendPlanGrid.tsx');
const { buildDividendHomePlan } = await import('../src/lib/dividendWorkbench.ts');
const i18n = createInstance();
await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: {
  zh: { translation: { ...dividendHomeZh, ...dividendGridZh, div_stock_budget: '分配总金额', div_touched: '已触及' } },
  en: { translation: { ...dividendHomeEn, ...dividendGridEn } },
}, interpolation: { escapeValue: false } });
const stock = { ...defaultDividendStocks()[0], weightBps: 10000,
  buyLevels: [{ priceMinor: 1000, yieldBps: 500, portionBps: 5000 }, { priceMinor: 800, yieldBps: 600, portionBps: 5000 }],
  sellLevels: [{ priceMinor: 1200, yieldBps: 400, portionBps: 5000 }, { priceMinor: 1400, yieldBps: 350, portionBps: 5000 }],
  quote: { priceMinor: 900, date: '2026-10-21', fetchedAt: 1 } };
const render = (amountVisible = true, totalBudgetMinor: number | undefined = 1000000) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
  createElement(DividendHomePlan, { stock, totalBudgetMinor, shares: 200, amountVisible, asOf: '2026-10-21', onEdit: () => undefined })));

test('home plan shows all buy and sell levels, budget and actionable quantities without expansion', () => {
  const html = render();
  assert.match(html, /当前计划/); assert.match(html, /调整计划/);
  for (const price of ['¥10', '¥8', '¥12', '¥14']) assert.ok(html.includes(price), price);
  assert.match(html, /整手差额 300 股/);
  assert.match(html, /累计持有 500 股/); assert.match(html, /累计持有 1,100 股/);
  assert.match(html, /累计卖出 100 股/); assert.match(html, /累计卖出 200 股/);
  assert.match(html, /¥10,000/); assert.match(html, /已持仓 200 股/);
  assert.match(html, /已触发第 1 档/); assert.match(html, /价格已触发/);
  assert.match(html, /第 2 档/);
  assert.match(html, /<details class="div-home-plan-note"><summary>股数计算说明/);
});

test('plan manager and homepage show the same highest price-triggered tier, including paused plans', () => {
  const paused = { ...stock, buyPaused: true, quote: { ...stock.quote, priceMinor: 800 } };
  const plan = buildDividendHomePlan(paused, 1000000, 200, '2026-10-21');
  const gridHtml = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendPlanGrid, { plan, side: 'buy', amountVisible: true })));
  const homeHtml = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendHomePlan, { stock: paused, totalBudgetMinor: 1000000, shares: 200, amountVisible: true, asOf: '2026-10-21', onEdit: () => undefined })));
  for (const html of [gridHtml, homeHtml]) {
    assert.match(html, /已触发第 2 档/);
    assert.equal((html.match(/价格已触发/g) ?? []).length, 2);
  }
  assert.match(gridHtml, /div-grid-row-triggered/);
  assert.match(homeHtml, /加仓已暂停/);
});

test('unusable quotes display refresh status without triggered rows on either surface', () => {
  const stale = { ...stock, quote: { ...stock.quote, date: '2026-10-01' } };
  const plan = buildDividendHomePlan(stale, 1000000, 200, '2026-10-21');
  const gridHtml = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendPlanGrid, { plan, side: 'buy', amountVisible: true })));
  const homeHtml = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendHomePlan, { stock: stale, totalBudgetMinor: 1000000, shares: 200, amountVisible: true, asOf: '2026-10-21', onEdit: () => undefined })));
  for (const html of [gridHtml, homeHtml]) {
    assert.match(html, /报价待更新/);
    assert.doesNotMatch(html, /已触发第|价格已触发|div-grid-row-triggered/);
  }
});

test('home plan respects amount privacy while retaining public price levels', () => {
  const html = render(false);
  assert.match(html, /已持仓 •••• 股/); assert.match(html, /整手差额 •••• 股/);
  assert.match(html, /¥10/); assert.doesNotMatch(html, /¥10,000|300 股|500 股|200 股|1,100 股/);
});

test('the compact grid retains saved target yields rather than recalculating them from a new dividend', () => {
  const changedDividend = { ...stock, manualDpsMicros: 1000000 };
  const plan = buildDividendHomePlan(changedDividend, 1000000, 200, '2026-10-21');
  assert.notEqual(plan.buy[0].displayYieldBps, plan.buy[0].yieldBps);
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendPlanGrid, { plan, side: 'buy', amountVisible: true })));
  assert.match(html, /<td>5%<\/td>/); assert.match(html, /<td>6%<\/td>/);
  assert.doesNotMatch(html, /<td>10%<\/td>/);
  assert.match(html, /<td>50%<\/td>/);
});

test('home plan shows allocation rather than fabricated zero shares when no budget exists', () => {
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(DividendHomePlan, { stock, shares: 200, amountVisible: true, asOf: '2026-10-21', onEdit: () => undefined })));
  assert.match(html, /尚未设置总预算/); assert.match(html, /累计 50%/);
  assert.doesNotMatch(html, /累计持有 0 股|可加仓 300 股/);
});
