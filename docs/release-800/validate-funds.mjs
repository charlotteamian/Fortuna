import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.FORTUNA_STAGE2_ORIGIN = 'http://127.0.0.1:5200';
const { isolate, seed, origin, captureTarget } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
const result = { success: false, scope: 'Isolated synthetic fund plan; external traffic blocked, no real data or device.', layouts: [], checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390]) for (const scale of [1, 1.3]) for (const themeMode of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => result.errors.push(error.message));
    await isolate(page); await seed(page);
    await page.evaluate(async ({ themeMode }) => {
      const { db, updateSettings } = await import('/src/db.ts');
      const saved = await db.settings.get('main');
      const funds = saved.dividendFundPlan.funds.map(fund => fund.id === 'fund-live'
        ? { ...fund, reference: { ...fund.reference, highMicros: 1500000, indexYieldBps: 550 } } : fund);
      await updateSettings({ themeMode, amountVisible: true, dividendStrategy: 'funds', dividendHomeCollapsedCodes: funds.map(fund => `fund:${fund.id}`),
        dividendFundPlan: { ...saved.dividendFundPlan, funds } });
    }, { themeMode });
    await page.goto(origin);
    await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
    const home = page.locator('.div-fund-home');
    await home.locator('.df-today-action.is-buy').waitFor();
    await page.waitForTimeout(400);
    await page.evaluate(scale => document.documentElement.style.setProperty('--font-scale', String(scale)), scale);
    assert.equal(await page.locator('.div-daily-advice').count(), 0, 'old fund audit panel is absent');
    assert.equal(await home.locator('.df-today-action.is-buy').count(), 1);
    assert.equal(await home.locator('.df-today-action.is-update').count(), 1);
    assert.match(await home.locator('.df-today-action.is-buy').innerText(), /已记录持仓 500 份/);
    assert.doesNotMatch(await home.locator('.df-today-action.is-buy').innerText(), /尚未关联/);
    assert.equal(await home.locator('[aria-expanded="true"]').count(), 0);
    const overflow = await home.evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
    assert.deepEqual(overflow, [], JSON.stringify({ width, scale, themeMode, overflow }));
    assert.doesNotMatch(await home.innerText(), /\b(?:df_|div_)[a-z_]+\b/, 'all visible fund copy is translated');
    const file = `fund-after-${width}-${scale}-${themeMode}.png`;
    await captureTarget(page, home, `${output}${file}`);
    result.layouts.push({ width, scale, themeMode, overflow, screenshot: file });
    if (width === 320 && scale === 1.3 && themeMode === 'light') {
      await page.locator('.div-wb-header').getByRole('button').click();
      const text = await home.innerText();
      assert.doesNotMatch(text, /已记录持仓 500 份|¥6,000|¥10,000|¥4,000/);
      assert.match(text, /已记录持仓 •••• 份/);
      await captureTarget(page, home, `${output}fund-after-320-1.3-light-hidden.png`);
      result.checks.push('hidden amounts mask allocated budgets and linked holdings');
    }
    if (width === 390 && scale === 1 && themeMode === 'dark') {
      await page.evaluate(async () => {
        const { db, updateSettings } = await import('/src/db.ts');
        const saved = await db.settings.get('main');
        await updateSettings({ dividendFundPlan: { ...saved.dividendFundPlan, funds: saved.dividendFundPlan.funds.map(fund => fund.id === 'fund-live'
          ? { ...fund, reference: { ...fund.reference, highMicros: 1200000, indexYieldBps: 450 } } : fund) } });
      });
      await page.reload();
      await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
      await home.locator('.df-today-action.is-sell').waitFor();
      assert.match(await home.locator('.df-today-action.is-sell').innerText(), /已记录持仓 500 份/);
      await captureTarget(page, home, `${output}fund-after-390-1-dark-sell.png`);
      const firstToggle = home.locator('.df-focus-evidence-toggle').first(); await firstToggle.click();
      await captureTarget(page, home.locator('.div-fund-home-card').first(), `${output}fund-after-390-1-dark-evidence.png`);
      assert.equal(await firstToggle.getAttribute('aria-expanded'), 'true');
      result.checks.push('swing exit reference respects the known linked holding and evidence opens separately');
    }
    await context.close();
  }
  assert.deepEqual(result.errors, []);
  result.checks.push('8 width/font/theme layouts have no fund overflow or untranslated keys; evidence is closed and old daily audit is absent');
  result.success = true;
} catch (error) { result.errors.push(error.stack ?? String(error)); }
await browser.close();
await writeFile(`${output}fund-browser-validation.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
