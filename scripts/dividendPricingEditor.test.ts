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
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';
import { dividendCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendStocks } from '../src/lib/dividendWorkbench.ts';
import { dividendAiWorkspaceZh } from '../src/i18n/dividendAiWorkspaceTranslations.ts';
import { dividendPricingGuideZh } from '../src/i18n/dividendPricingGuideTranslations.ts';

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
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText };
    return nextLoad(url, context);
  },
});
const { DividendPricingEditor, DividendPricingCard } = await import('../src/components/DividendAdvisorPricing.tsx');
const i18n = createInstance();
await i18n.init({ lng: 'zh', resources: { zh: { translation: { ...dividendAiWorkspaceZh, ...dividendPricingGuideZh } } }, interpolation: { escapeValue: false } });
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

test('default and custom yield inputs display percentages and the sell direction matches validation', () => {
  const defaults = render(createElement(DividendPricingEditor, { method: defaultDividendPricingMethod(), disabled: false, onSave: async () => undefined }));
  assert.match(defaults, /value="5\.5, 5\.75, 6, 6\.5"/); assert.match(defaults, /value="4\.8, 4\.5, 4\.2, 4"/);
  assert.match(defaults, /从大到小/); assert.doesNotMatch(defaults, /value="550/);
  const custom = render(createElement(DividendPricingEditor, { method: { ...defaultDividendPricingMethod(), buyYieldBps: [700, 800, 900, 1000], sellYieldBps: [600, 500, 400, 300] }, disabled: false, onSave: async () => undefined }));
  assert.match(custom, /买入股息率：7% \/ 8% \/ 9% \/ 10%/);
  assert.match(custom, /卖出股息率：6% \/ 5% \/ 4% \/ 3%/);
});

test('the price card shows one buy/sell grid and a confirmation button without another preview grid', () => {
  const method = defaultDividendPricingMethod(), asOf = '2026-11-06';
  const pricing = calculateDividendPricing({ code: '600000', name: 'Synthetic', method, asOf, annuals: [], financialSector: true, dividendBase: verifiedDividendBase(500000, asOf) });
  const html = render(createElement(DividendPricingCard, { code: '600000', pricing, method, generatedAt: 1, disabled: false, onUpdated: async () => undefined }));
  assert.equal((html.match(/<table /g) ?? []).length, 2);
  assert.match(html, /确认写入网格计划/); assert.doesNotMatch(html, /div-ai-grid-comparison|div-ai-confirm/);
});

test('an old check cannot render or apply its grid using a new snapshot without a dividend base', () => {
  const method = defaultDividendPricingMethod(), asOf = '2026-11-06';
  const pricing = calculateDividendPricing({ code: '600000', name: 'Synthetic', method, asOf, annuals: [], financialSector: true, dividendBase: verifiedDividendBase(500000, asOf) });
  const check = dividendCheckSummary({ stock: { ...defaultDividendStocks()[0], code: '600000' }, asOf,
    research: { code: '600000', name: 'Synthetic', pricing, checks: [], sources: [], issues: [], status: 'unknown' } });
  assert.ok(check.currentPlan);
  const missingBase = calculateDividendPricing({ code: '600000', name: 'Synthetic', method, asOf, annuals: [], financialSector: true });
  const html = render(createElement(DividendPricingCard, { code: '600000', pricing: missingBase, method, check, generatedAt: 1, disabled: false, onUpdated: async () => undefined }));
  assert.match(html, /div-price-guide is-waiting/);
  assert.doesNotMatch(html, /确认写入网格计划|div-ai-plan-actions|<table /);
});

test('only matching checked and current pricing grids can display a new plan or offer confirmation', () => {
  const method = defaultDividendPricingMethod(), asOf = '2026-11-06';
  const pricing = calculateDividendPricing({ code: '600000', name: 'Synthetic', method, asOf, annuals: [], financialSector: true, dividendBase: verifiedDividendBase(500000, asOf) });
  const check = dividendCheckSummary({ stock: { ...defaultDividendStocks()[0], code: '600000' }, asOf,
    research: { code: '600000', name: 'Synthetic', pricing, checks: [], sources: [], issues: [], status: 'unknown' } });
  assert.ok(check.currentPlan);
  const renderChecked = (currentPricing = pricing, currentCheck = check) => render(createElement(DividendPricingCard, { code: '600000', pricing: currentPricing, method, check: currentCheck, generatedAt: 1, disabled: false, onUpdated: async () => undefined }));
  const matching = renderChecked();
  assert.equal((matching.match(/<table /g) ?? []).length, 2);
  assert.match(matching, /确认写入网格计划/);
  const differentBase = calculateDividendPricing({ code: '600000', name: 'Synthetic', method, asOf, annuals: [], financialSector: true, dividendBase: verifiedDividendBase(600000, asOf) });
  assert.doesNotMatch(renderChecked(differentBase), /确认写入网格计划|div-ai-plan-actions|<table /);
  assert.match(renderChecked(differentBase), /div-price-guide is-waiting/);
  assert.doesNotMatch(renderChecked(pricing, { ...check, currentPlan: null }), /确认写入网格计划|div-ai-plan-actions|<table /);
});
