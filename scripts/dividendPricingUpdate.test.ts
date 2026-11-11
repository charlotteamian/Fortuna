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
import { dividendPricingPlan, dividendPricingPlanChange, dividendPricingProvenance } from '../src/lib/dividendPricingPlan.ts';
import { dividendCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendStocks } from '../src/lib/dividendWorkbench.ts';
import { dividendCheckZh } from '../src/i18n/dividendCheckTranslations.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';

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
const { default: PricingUpdate } = await import('../src/components/DividendPricingUpdate.tsx');
const i18n = createInstance();
await i18n.init({ lng: 'zh', resources: { zh: { translation: dividendCheckZh } }, interpolation: { escapeValue: false } });
const asOf = '2026-11-11', now = Date.parse('2026-11-11T02:00:00Z');
const pricing = calculateDividendPricing({ code: '300750', name: 'Synthetic', financialSector: false, annuals: [], asOf,
  method: defaultDividendPricingMethod(), dividendBase: verifiedDividendBase(8368000, asOf) });
const plan = dividendPricingPlan(pricing)!;
const stock = { ...defaultDividendStocks()[0], code: '300750', ...structuredClone(plan), gridProvenance: dividendPricingProvenance(pricing, now) };
const checked = dividendCheckSummary({ stock, asOf, now, research: { code: '300750', name: 'Synthetic', pricing,
  checks: [], sources: [], issues: [], status: 'unknown' } });
const render = (props: Partial<Parameters<typeof PricingUpdate>[0]> = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(PricingUpdate, {
  pricing, check: checked, savedStock: stock, amountVisible: true, outdated: false, disabled: false, onOpen() {}, onRetry() {}, ...props,
})));

test('a difference in only the last sell price is visible even when the first buy price matches', () => {
  const saved = structuredClone(stock); saved.sellLevels[3].priceMinor!--;
  const change = dividendPricingPlanChange(plan, saved);
  assert.equal(change.status, 'changed'); assert.equal(change.changedCount, 1);
  assert.equal(change.firstChange?.side, 'sell'); assert.equal(change.firstChange?.index, 4);
  const html = render({ savedStock: saved });
  assert.match(html, /新价格待确认/); assert.match(html, /卖出第 4 档/); assert.match(html, /查看并确认更新/);
  assert.doesNotMatch(html, /<table|8 档价格与已保存一致/);
});

test('unchanged prices, changed tier settings and missing saved prices have separate results', () => {
  assert.equal(dividendPricingPlanChange(plan, stock).status, 'same');
  const settings = structuredClone(stock); settings.buyLevels[0].yieldBps++;
  assert.equal(dividendPricingPlanChange(plan, settings).status, 'parameters');
  assert.match(render({ savedStock: settings }), /价格未变，档位设置待确认/);
  const partial = structuredClone(stock); partial.sellLevels[3].priceMinor = undefined;
  assert.equal(dividendPricingPlanChange(plan, partial).status, 'changed');
  assert.doesNotMatch(render({ savedStock: partial }), /8 档价格与已保存一致/);
  assert.equal(dividendPricingPlanChange(plan).status, 'unsaved');
  assert.match(render({ savedStock: undefined }), /新价格已生成，尚未保存/);
});

test('matching prices still expose confirmation when the saved evidence needs review', () => {
  assert.match(render(), /重算完成，8 档价格与已保存一致/);
  assert.match(render({ check: { ...checked, grid: { ...checked.grid, status: 'saved_unverified' } } }), /价格一致，计算依据待确认/);
});

test('hidden amounts and stale or mismatched calculations never expose a fresh price update', () => {
  assert.equal(render({ amountVisible: false }), '');
  const stale = render({ outdated: true });
  assert.match(stale, /价格需要重新检查|重新检查本股/); assert.doesNotMatch(stale, /136\.93|查看并确认更新|重算完成/);
  assert.doesNotMatch(render({ check: { ...checked, currentPlan: null } }), /重算完成|新价格待确认/);
  assert.doesNotMatch(render({ pricing: { ...pricing, canApply: false, blockers: ['dividend_base_unverified'] } }), /重算完成|新价格待确认/);
});
