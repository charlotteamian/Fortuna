import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

process.env.FORTUNA_STAGE2_ORIGIN = 'http://127.0.0.1:5210';
const { isolate, seed, origin, captureTarget } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
const result = { success: false, scope: 'Isolated Chrome profiles and synthetic fixtures; external traffic blocked; no real user database or live service.', checks: [], layouts: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const check = name => result.checks.push({ name, passed: true });

async function prepare(page, preferences = true) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => result.errors.push(error.message));
  await isolate(page);
  // Use the current module exports; the historical fixture's research stub predates them.
  await page.route('**/src/services/dividendResearchService.ts*', route => route.continue());
  await seed(page, { preferences });
}

async function home(page) {
  await page.goto(origin);
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
}

async function layout(scope, page, name, width, scale, theme) {
  const issues = await scope.evaluate(root => [...root.querySelectorAll('*')].filter(element => {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.right > innerWidth + 1 || rect.left < -1;
  }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80) })));
  assert.deepEqual(issues, [], `${name} overflow ${width}/${scale}/${theme}`);
  assert.doesNotMatch(await scope.innerText(), /\b(?:df_|div_)[a-z_]+\b/);
  result.layouts.push({ name, width, scale, theme, overflow: issues });
}

try {
  const selectionContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const selectionPage = await selectionContext.newPage();
  await prepare(selectionPage);
  await selectionPage.evaluate(async () => (await import('/src/db.ts')).updateSettings({ amountVisible: true, dividendStrategy: 'stocks' }));
  await home(selectionPage);
  await selectionPage.locator('.div-wb-stocks').waitFor();
  await selectionPage.locator('.div-home-advisor').getByRole('button', { name: /选股与计划/ }).click();
  const reader = selectionPage.locator('.div-advisor-reader');
  await reader.locator('.div-ai-research-card').first().waitFor();
  assert.equal(await reader.locator('.div-ai-research-card').count(), 10);
  await reader.locator('.div-ai-research-toggle').first().click();
  await reader.locator('.div-ai-pricing-card').first().waitFor();
  await captureTarget(selectionPage, reader, `${output}selection-390.png`);
  await layout(reader, selectionPage, 'selection', 390, 1, 'dark');
  check('Existing saved plans and research open selection; expanding pricing does not blank the page');
  await reader.getByRole('button', { name: '返回', exact: true }).click();
  await selectionPage.locator('.div-wb-stocks').waitFor();
  await selectionPage.locator('.tab-bar').getByRole('button', { name: /计划/ }).click();
  await selectionPage.locator('.plan-overview').waitFor();
  check('Allocation plan navigation still opens');
  await selectionContext.close();

  for (const width of [320, 390]) for (const scale of [1, 1.3]) for (const themeMode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    await prepare(page);
    await page.evaluate(async ({ themeMode }) => {
      const { db, updateSettings } = await import('/src/db.ts');
      const saved = await db.settings.get('main');
      await updateSettings({ themeMode, amountVisible: true, dividendStrategy: 'funds', dividendFundPlan: {
        ...saved.dividendFundPlan, mode: 'rebalance', funds: saved.dividendFundPlan.funds.map((fund, index) => ({ ...fund,
          note: 'FIRST TIER LONG LEGACY FORMULA MUST STAY IN EDITOR',
          reference: index ? undefined : { ...fund.reference, highMicros: 1082000 },
        })),
      } });
    }, { themeMode });
    await home(page);
    const fundHome = page.locator('.div-fund-home');
    await fundHome.locator('.df-focus-buy-grid').first().waitFor();
    await page.evaluate(value => document.documentElement.style.setProperty('--font-scale', String(value)), scale);
    const firstGrid = fundHome.locator('.df-focus-buy-grid').first();
    assert.equal(await firstGrid.locator('tbody tr').count(), 3);
    const gridPrices = await firstGrid.locator('tbody td').allTextContents();
    assert.deepEqual(gridPrices, ['¥0.9738', '¥0.87642', '¥0.832599']);
    assert.equal(await fundHome.locator('.df-focus-evidence-toggle').count(), 0);
    assert.doesNotMatch(await fundHome.innerText(), /依据与数据|FIRST TIER LONG LEGACY FORMULA|相对前高回撤|跟踪指数股息率/);
    assert.ok((await fundHome.locator('.df-focus-buy-grid').nth(1).innerText()).includes('—') || (await fundHome.locator('.df-focus-buy-grid').nth(1).innerText()).includes('待'));
    await layout(fundHome, page, 'fund home', width, scale, themeMode);
    if (width === 390 && scale === 1 && themeMode === 'light') {
      await captureTarget(page, fundHome.locator('.div-fund-home-card').first(), `${output}fund-390-light.png`);
      await fundHome.getByRole('button', { name: '编辑', exact: true }).first().click();
      const dialog = page.locator('.div-wb-dialog[open]');
      await dialog.locator('.df-fund-list .df-focus-buy-grid').first().waitFor();
      assert.equal(await dialog.locator('.df-fund-list .df-focus-evidence-toggle').count(), 0);
      assert.deepEqual(await dialog.locator('.df-focus-buy-grid').first().locator('tbody td').allTextContents(), gridPrices);
      check('Fund home and management share the three-tier grid and omit evidence prose');
      await dialog.locator('.div-wb-dialog-header button').click();
    }
    if (width === 320 && scale === 1.3 && themeMode === 'light') {
      await page.locator('.div-wb-header').getByRole('button').click();
      assert.doesNotMatch(await firstGrid.innerText(), /0\.9738|0\.87642|0\.832599/);
      assert.equal(await firstGrid.getByText('••••', { exact: true }).count(), 3);
      check('Amount visibility masks all three grid prices');
    }
    await context.close();
  }
  check('Eight width/font/theme combinations have readable grids without overflow or untranslated copy');
  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (error) {
  result.errors.push(error.stack ?? String(error));
} finally {
  await browser.close();
  await writeFile(`${output}ui-verification.json`, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
