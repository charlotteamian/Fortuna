import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planLadderEn, planLadderZh } from '../src/i18n/planLadderTranslations.ts';
import { dividendWorkbenchEn, dividendWorkbenchZh } from '../src/i18n/dividendWorkbenchTranslations.ts';
import { dividendAiWorkspaceEn, dividendAiWorkspaceZh } from '../src/i18n/dividendAiWorkspaceTranslations.ts';
import { dividendFocusEn, dividendFocusZh } from '../src/i18n/dividendFocusTranslations.ts';

const planPageTsx = readFileSync(new URL('../src/pages/PlanPage.tsx', import.meta.url), 'utf8');
const planPageCss = readFileSync(new URL('../src/pages/PlanPage.css', import.meta.url), 'utf8');
const dividendPageTsx = readFileSync(new URL('../src/pages/DividendPage.tsx', import.meta.url), 'utf8');
const dividendPageCss = readFileSync(new URL('../src/pages/DividendPage.css', import.meta.url), 'utf8');
const workspaceTsx = readFileSync(new URL('../src/components/DividendAdvisorWorkspace.tsx', import.meta.url), 'utf8');
const readerTsx = readFileSync(new URL('../src/components/DividendAdvisorReader.tsx', import.meta.url), 'utf8');
const dailyAdviceTsx = readFileSync(new URL('../src/components/DividendDailyAdvice.tsx', import.meta.url), 'utf8');
const advisorCss = readFileSync(new URL('../src/components/DividendAdvisor.css', import.meta.url), 'utf8');

test('DividendPage shares amountVisible state via AppContext instead of a local useState', () => {
  assert.match(dividendPageTsx, /import\s*\{\s*useAppContext\s*\}\s*from\s*'\.\.\/app-context'/);
  assert.match(dividendPageTsx, /const\s*\{\s*amountVisible,\s*setAmountVisible\s*\}\s*=\s*useAppContext\(\)/);
  assert.doesNotMatch(dividendPageTsx, /const\s*\[\s*amountVisible\s*,\s*setAmountVisible\s*\]\s*=\s*useState/);
});

test('PlanPage delegates Dividend workbench header to DividendPage without duplicate stacked headers', () => {
  assert.doesNotMatch(planPageTsx, /className="plan-subpage-bar"/);
  assert.match(planPageTsx, /<DividendPage[\s\S]*onBack=/);
  assert.match(planPageTsx, /<DividendPage[\s\S]*sharedQuotaMinor=/);
  assert.doesNotMatch(dividendPageTsx, /className="div-focus-top-tools"/);
  assert.match(dividendPageTsx, /className="div-wb-nav-row"/);
  assert.match(dividendPageTsx, /className="div-wb-quota-chip"/);
});

test('DividendPage header navigation buttons prevent vertical text wrapping and squishing', () => {
  assert.match(dividendPageCss, /\.div-wb-back-btn[\s\S]*white-space:\s*nowrap/);
  assert.match(dividendPageCss, /\.div-wb-back-btn[\s\S]*flex-shrink:\s*0/);
  assert.match(dividendPageCss, /@container\s+dividend-page/);
  assert.match(planPageCss, /@container\s+plan-page/);
});

test('PlanPage uses i18n for default dividend plan name and dynamic viewport units', () => {
  assert.doesNotMatch(planPageTsx, /setFormName\('红利价值板块'\)/);
  assert.match(planPageTsx, /t\('plan_dividend_default_name'\)/);
  assert.doesNotMatch(planPageTsx, /maxHeight:\s*'85vh'/);
});

test('DividendPage wires autoReviewPendingDividendStocks on entry and stock open', () => {
  assert.match(dividendPageTsx, /from\s*'\.\.\/services\/dividendAutoReviewService'/);
  assert.match(dividendPageTsx, /autoReviewPendingDividendStocks\(/);
  assert.match(dividendPageTsx, /div_auto_review_running/);
  assert.match(dividendPageTsx, /div_auto_review_failed_summary/);
  assert.match(dividendPageTsx, /div_auto_review_retry/);
});

test('all added Plan and Dividend workbench i18n keys exist in both zh and en', () => {
  for (const key of ['plan_open_dividend_short', 'plan_dividend_default_name', 'plan_refresh_quotes_short']) {
    assert.ok(planLadderZh[key]?.trim(), `missing zh key ${key}`);
    assert.ok(planLadderEn[key]?.trim(), `missing en key ${key}`);
  }
  for (const key of ['div_wb_refresh_short', 'div_wb_hide_short', 'div_wb_show_short', 'div_wb_nav_label']) {
    assert.ok((dividendWorkbenchZh as Record<string, string>)[key]?.trim(), `missing zh key ${key}`);
    assert.ok((dividendWorkbenchEn as Record<string, string>)[key]?.trim(), `missing en key ${key}`);
  }
  for (const key of ['div_selection_plan_count', 'div_selection_batch_tools']) {
    assert.ok((dividendFocusZh as Record<string, string>)[key]?.trim(), `missing zh key ${key}`);
    assert.ok((dividendFocusEn as Record<string, string>)[key]?.trim(), `missing en key ${key}`);
  }
  for (const key of [
    'div_ai_research_restored_short',
    'div_ai_check_settings',
    'div_ai_principles_advisory_title',
    'div_ai_principles_advisory_body',
    'div_ai_principles_presets_label',
    'div_ai_principles_presets_hint',
    'div_ai_preset_baseline',
    'div_ai_preset_balanced',
    'div_ai_preset_strict',
    'div_ai_rule_hint_minYieldBps',
    'div_ai_rule_hint_minRevenueGrowthBps',
    'div_ai_rule_hint_minProfitGrowthBps',
    'div_ai_rule_hint_minFcfCoverageBps',
  ]) {
    assert.ok((dividendAiWorkspaceZh as Record<string, string>)[key]?.trim(), `missing zh key ${key}`);
    assert.ok((dividendAiWorkspaceEn as Record<string, string>)[key]?.trim(), `missing en key ${key}`);
  }
});

test('DividendAdvisorWorkspace compacts top plan layout, removes div_ai_reading_hidden, and provides screening presets', () => {
  assert.doesNotMatch(workspaceTsx, /div_ai_reading_hidden/);
  assert.doesNotMatch(workspaceTsx, /div_focus_selection_intro/);
  assert.match(workspaceTsx, /hidden=\{collapsed\}/);
  assert.match(workspaceTsx, /className="div-selection-header-bar"/);
  assert.match(workspaceTsx, /className="div-selection-drawers"/);
  assert.match(workspaceTsx, /div_ai_principles_advisory_title/);
  assert.match(workspaceTsx, /PRINCIPLE_PRESETS/);
  assert.match(workspaceTsx, /id:\s*'baseline'/);
  assert.match(workspaceTsx, /id:\s*'balanced'/);
  assert.match(workspaceTsx, /id:\s*'strict'/);
  assert.match(advisorCss, /\.div-filters\.div-read-filters[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(dividendPageTsx, /onAddStock=\{startAdd\}/);
  assert.match(dividendPageTsx, /onShowAmounts=\{\(\)\s*=>\s*setAmountVisible\(true\)\}/);
});

test('DividendDailyAdvice and DividendAdvisorReader gate hidden notices and expose settings on error', () => {
  assert.match(dailyAdviceTsx, /hasGeneratedAdvice/);
  assert.match(dailyAdviceTsx, /!amountVisible\s*&&\s*hasGeneratedAdvice/);
  assert.match(readerTsx, /onShowAmounts\?: \(\) => void/);
  assert.match(readerTsx, /configured \? 'div_ai_check_settings' : 'div_ai_go_settings'/);
});
