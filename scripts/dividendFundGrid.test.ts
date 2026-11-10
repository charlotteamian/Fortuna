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
import { dividendFundGridPrices } from '../src/lib/dividendFundGrid.ts';
import { dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendFundPlan, type DividendFund, type DividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { dividendFundFocusZh, dividendFundFocusEn } from '../src/i18n/dividendFundFocusTranslations.ts';
import { dividendFundTodayZh, dividendFundTodayEn } from '../src/i18n/dividendFundTodayTranslations.ts';

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
const { default: FundSummary } = await import('../src/components/DividendFundPlanSummary.tsx');
const { default: FundHome } = await import('../src/components/DividendFundHomePlan.tsx');
const { default: FundWorkbench } = await import('../src/components/DividendFundWorkbench.tsx');
const i18n = createInstance();
await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: {
  zh: { translation: { ...dividendFundFocusZh, ...dividendFundTodayZh } },
  en: { translation: { ...dividendFundFocusEn, ...dividendFundTodayEn } },
}, interpolation: { escapeValue: false } });
const asOf = '2026-11-10', now = Date.parse(`${asOf}T11:15:00+08:00`);
const fund: DividendFund = { id: 'grid-fund', code: '512890', name: 'Synthetic dividend fund', indexKind: 'low_volatility', weightBps: 10000,
  quote: { priceMicros: 1057000, date: `${asOf} 11:15`, fetchedAt: now },
  reference: { highMicros: 1082000, indexYieldBps: 450, asOf: '2026-10-08' },
  note: 'Private saved formula note must stay in the editor, not in the reading card.' };
const plan: DividendFundPlan = { ...defaultDividendFundPlan(), mode: 'rebalance', budgetMinor: 1000000, funds: [fund] };
const check = (value = fund, settings = plan) => dividendFundCheckSummary({ fund: value, plan: settings, asOf, now });
const render = (component: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));
const pricesIn = (html: string) => html.match(/<div class="df-focus-buy-grid">(.*?)<\/div>/s)![1];

test('fund reference grid uses the engine entry then integer 90% and 95% follow-on prices', () => {
  const original = structuredClone(plan);
  const summary = check();
  assert.equal(summary.grid.entryPriceMicros, 973800);
  assert.deepEqual(dividendFundGridPrices(summary.grid.entryPriceMicros), [973800, 876420, 832599]);
  assert.deepEqual(dividendFundGridPrices(11), [11, 10, 10], 'each reference rounds to whole micros');
  for (const invalid of [undefined, 0, -1, NaN, 1.5]) assert.deepEqual(dividendFundGridPrices(invalid), []);
  assert.deepEqual(plan, original, 'reading follow-on references does not mutate the saved plan');
  assert.equal(summary.trigger.buy, 'not_triggered', 'the existing first-level trigger remains authoritative');
});

test('home and management expose the same three prices directly and omit evidence and free-form notes', () => {
  const checks = { [fund.id]: check() };
  const surfaces = [
    render(createElement(FundHome, { plan, checks, amountVisible: true, asOf, onEdit: () => undefined,
      collapsedCodes: [], onToggle: () => undefined, readFilter: 'all', search: '' })),
    render(createElement(FundWorkbench, { plan, checks, amountVisible: true, onSaved: async () => undefined })),
  ];
  for (const html of surfaces) {
    const grid = pricesIn(html);
    for (const value of ['第 1 档', '第 2 档', '第 3 档', '¥0.9738', '¥0.87642', '¥0.832599']) assert.ok(grid.includes(value), value);
    assert.doesNotMatch(grid, /<details|hidden=/);
    assert.doesNotMatch(html, /依据与数据|df-focus-evidence|Private saved formula|90%|×/);
    assert.match(html, /年度再平衡/);
  }
});

test('fund grid does not invent levels without a high and respects amount hiding', () => {
  const noHigh = { ...fund, reference: { ...fund.reference!, highMicros: undefined } };
  const missing = pricesIn(render(createElement(FundSummary, { plan, fund: noHigh, check: check(noHigh), amountVisible: true })));
  assert.match(missing, /待补基准高点/);
  assert.doesNotMatch(missing, /第 1 档|¥0\./);
  const hidden = pricesIn(render(createElement(FundSummary, { plan, fund, check: check(), amountVisible: false })));
  assert.equal((hidden.match(/••••/g) ?? []).length, 3);
  assert.doesNotMatch(hidden, /¥|0\.9738|0\.87642|0\.832599/);
  assert.match(hidden, /第 3 档/);
});

test('swing exit still uses the original high independently of the reading grid', () => {
  const swing = { ...plan, mode: 'swing' as const };
  const summary = check(fund, swing);
  const html = render(createElement(FundSummary, { plan: swing, fund, check: summary, amountVisible: true }));
  assert.equal(summary.grid.exitPriceMicros, 1082000);
  assert.match(html, /¥1\.082/);
  assert.equal(summary.trigger.sell, 'not_triggered');
});
