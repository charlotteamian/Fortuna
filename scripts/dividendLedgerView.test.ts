import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ts from 'typescript';
import type { DividendLedger, DividendLedgerBase } from '../src/lib/dividendLedger.ts';
import { dividendLedgerV5Zh, dividendLedgerV5En } from '../src/i18n/dividendLedgerV5Translations.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
    return nextLoad(url, context);
  },
});
const { default: DividendLedgerView } = await import('../src/components/DividendLedgerView.tsx');
const i18n = createInstance();
await i18n.init({ lng: 'zh', fallbackLng: 'en', resources: { zh: { translation: dividendLedgerV5Zh }, en: { translation: dividendLedgerV5En } }, interpolation: { escapeValue: false } });
const ledger: DividendLedger = { code: '000001', asOf: '2026-10-29', complete: true, issues: [], sourceUrls: [], events: [
  { id: 'verified', batchId: 'verified', code: '000001', reportDate: '2025-12-31', period: 'annual', announcementDate: '2026-06-01', recordDate: '2026-06-10', exDate: '2026-06-11',
    cashPer10Micros: 2_490_000, bonusPer10Bps: 0, transferPer10Bps: 0, shareFactor: 1, normalizedDpsMicros: 249_000, implemented: true, stage: 'implemented', verification: 'verified', issues: [],
    sources: [{ provider: 'eastmoney', url: 'https://data.eastmoney.com/yjfp/detail/000001.html', announcementDate: '2026-06-01' }, { provider: 'cninfo', url: 'https://static.cninfo.com.cn/announcement.pdf', announcementDate: '2026-06-01', verifiedAt: '2026-10-28' }] },
  { id: 'conflict', batchId: 'conflict', code: '000001', reportDate: '2025-06-30', period: 'interim', announcementDate: '2025-10-01', recordDate: '2025-10-10', exDate: '2025-10-11',
    cashPer10Micros: 3_600_000, bonusPer10Bps: 0, transferPer10Bps: 0, shareFactor: 1, implemented: true, stage: 'implemented', verification: 'conflict', sources: [], issues: ['SOURCE_CONFLICT'] },
  { id: 'proposal', batchId: 'proposal', code: '000001', reportDate: '2026-06-30', period: 'interim', announcementDate: '2026-10-20', exDate: '2026-11-10', cashPer10Micros: 5_000_000,
    implemented: false, stage: 'proposal', verification: 'unverified', sources: [{ provider: 'eastmoney', url: 'javascript:alert(1)' }], issues: ['EVENT_FIELDS_INCOMPLETE'] },
  { id: 'unknown', batchId: 'unknown', code: '000001', period: 'unknown', implemented: false, stage: 'unknown', verification: 'unverified', sources: [], issues: ['FUTURE_UNKNOWN_FLAG'] },
] };
const base: DividendLedgerBase = { dpsMicros: 609_000, asOf: ledger.asOf, frequency: 'semiannual', requiredBatches: 2, selectedBatchIds: ['verified', 'conflict'], verified: false,
  flags: ['SOURCE_CONFLICT', 'PROPOSAL_NOT_COUNTED'], sourceUrls: [], reportPeriods: ['2025-12-31', '2025-06-30'], crosscheckDpsMicros: 600_000, crosscheckDeviationBps: 148 };
const render = (value = ledger, calculated: DividendLedgerBase | undefined = base) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(DividendLedgerView, { ledger: value, base: calculated })));

test('ledger presentation keeps dates, amounts and selected batch verification distinct without nested menus', () => {
  const html = render();
  assert.match(html, /半年分红 · 最近两批/); assert.match(html, /所选 2／2 批/);
  for (const date of ['2026-06-01', '2026-06-10', '2026-06-11', '2025-12-31', '2026-10-28']) assert.ok(html.includes(date), date);
  assert.match(html, /2\.49 元/); assert.match(html, /0\.249 元/); assert.match(html, /来源冲突 · 排除计算/);
  assert.match(html, /本次候选批次 · 尚待核实/); assert.doesNotMatch(html, /class="div-ledger-selection">计入本次基数/);
  assert.doesNotMatch(html, /<details|<summary|SOURCE_CONFLICT|PROPOSAL_NOT_COUNTED|EVENT_FIELDS_INCOMPLETE|FUTURE_UNKNOWN_FLAG/);
});

test('unimplemented announcements stay in forward references and never show an included amount', () => {
  const html = render({ ...ledger, events: [ledger.events[2]] }, { ...base, selectedBatchIds: [], dpsMicros: undefined, flags: ['INCOMPLETE', 'PROPOSAL_NOT_COUNTED'] });
  assert.match(html, /已公告未实施 · 前瞻参考/); assert.match(html, /尚未实施，不计入本次分红基数/); assert.match(html, /5 元/);
  assert.match(html, /折至当前股本／股<\/dt><dd>未计入/); assert.doesNotMatch(html, /div-ledger-group implemented|Included in this base|javascript:|alert\(1\)/);
  assert.match(html, /来源链接待核验/);
});

test('only a verified selected implemented batch receives the included marker; absent data remains unverified', () => {
  const verified = render({ ...ledger, events: [ledger.events[0]] }, { ...base, verified: true, frequency: 'annual', requiredBatches: 1, selectedBatchIds: ['verified'], flags: [] });
  assert.match(verified, /计入本次基数/); assert.match(verified, /年度分红 · 最近一批/);
  const absent = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(DividendLedgerView, { ledger: { ...ledger, events: [ledger.events[3]] } })));
  assert.match(absent, /待核验记录/); assert.match(absent, /所属期待核实/); assert.match(absent, /仍有资料待核验/);
  assert.doesNotMatch(absent, /NaN|undefined|null/);
});

test('English ledger strings are complete and do not expose translation or source-status keys', async () => {
  await i18n.changeLanguage('en');
  const html = render();
  assert.match(html, /Dividend ledger/); assert.match(html, /Source conflict · excluded/); assert.match(html, /Record date/); assert.match(html, /CNY 0\.249/);
  assert.doesNotMatch(html, /div_ledger_|SOURCE_CONFLICT/);
  await i18n.changeLanguage('zh');
});
