import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5186';
const output = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const result = { environment: 'Fresh isolated Chrome profile; ten synthetic stocks and two synthetic funds; no real user database, external AI, live quotes or announcement requests.', checks: [], errors: [], layouts: [], screenshots: [] };
page.on('pageerror', error => result.errors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname.startsWith('/qt-api/')) {
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '') + '150000';
    const codes = [...Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(6, '0')), '515450', '512890'];
    const body = codes.map(code => { const f = Array(40).fill(''); f[1] = 'Synthetic'; f[2] = code; f[3] = code.startsWith('5') ? '1' : '11.20'; f[30] = stamp; f[32] = '0'; return `v_${code.startsWith('5') ? 'sh' : 'sz'}${code}="${f.join('~')}";`; }).join('\n');
    return route.fulfill({ body });
  }
  if (/api\//.test(url.pathname)) return route.abort();
  return route.continue();
});
const capture = async name => { await page.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`); };
const measure = async (width, scale, state) => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    listHeight: Math.round(document.querySelector('.div-stock-home .div-stock-list').getBoundingClientRect().height),
    listScrollHeight: document.querySelector('.div-stock-home .div-stock-list').scrollHeight,
    tenCardsHeight: Math.round([...document.querySelectorAll('.div-stock-reading')].reduce((n, e) => n + e.getBoundingClientRect().height, 0)),
    firstCardHeight: Math.round(document.querySelector('.div-stock-reading').getBoundingClientRect().height),
    visibleGridTables: [...document.querySelectorAll('.div-stock-reading table')].filter(e => e.getClientRects().length).length,
    visibleForecasts: [...document.querySelectorAll('.div-stock-reading .div-forecast-line')].filter(e => e.getClientRects().length).length,
    overflow: [...document.querySelectorAll('.dividend-page *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => ({ tag: e.tagName, class: e.className, right: Math.round(e.getBoundingClientRect().right) })).slice(0, 10) }));
  result.layouts.push({ width, scale, state, ...layout });
};
try {
  await page.goto(origin);
  await page.evaluate(async () => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    await initializeSettings();
    const date = dateInChina(), now = Date.now();
    await updateSettings({ language: 'zh', amountVisible: false, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      themeMode: 'dark', dividendWorkbenchInitialized: true, dividendBudgetMinor: 3000000, dividendStrategy: 'stocks', dividendHomeCollapsedCodes: [],
      dividendFundPlan: { budgetMinor: 1000000, mode: 'swing', entryRule: 'both', drawdownBps: 1000, indexYieldBps: 500, funds: [
        { id: 'synthetic-fund-1', name: '模拟基金甲', code: '515450', indexKind: 'low_volatility', weightBps: 5000, reference: { asOf: date, priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, source: 'Synthetic only' } },
        { id: 'synthetic-fund-2', name: '模拟基金乙', code: '512890', indexKind: 'low_volatility_100', weightBps: 5000, reference: { asOf: date, priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, source: 'Synthetic only' } },
      ] } });
    await db.dividendStocks.bulkPut(Array.from({ length: 10 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `模拟红利股票${i + 1}`, group: 'core', weightBps: 1000,
      shareMode: 'manual', manualShares: 200, lotSize: 100, buyPaused: i === 0, manualDpsMicros: 609000,
      buyLevels: [996, 953, 913, 843].map((priceMinor, j) => ({ priceMinor, yieldBps: [550, 575, 600, 650][j], portionBps: 2500 })),
      sellLevels: [1142, 1218, 1305, 1371].map((priceMinor, j) => ({ priceMinor, yieldBps: [480, 450, 420, 400][j], portionBps: 2500 })),
      dividend: { schemaVersion: 2, asOf: date, windowStart: date, payments: [], fetchedAt: now }, quote: { priceMinor: 1120, date: `${date} 15:00`, fetchedAt: now } })));
  });
  await page.reload();
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-stock-reading').first().waitFor();
  assert.equal(await page.locator('.div-stock-reading').count(), 10);
  assert.equal(await page.locator('.div-fund-home-card').count(), 2);
  assert.match(await page.locator('.div-stock-reading .div-home-plan-budget').first().innerText(), /3,000/);
  assert.equal(await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('main'))?.amountVisible), false);
  result.checks.push('Dividend amounts default visible while global asset amounts are hidden.');
  await capture('home-390-expanded');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await measure(width, 1, 'expanded');
    const toggles = page.locator('.div-stock-toggle[aria-expanded="true"]');
    while (await toggles.count()) await toggles.first().click();
    await measure(width, 1, 'collapsed');
    await page.locator('.div-stock-reading').first().scrollIntoViewIfNeeded();
    await capture(`stocks-${width}-collapsed`);
    await page.locator('.div-stock-reading').first().screenshot({ path: `${output}stock-card-${width}-collapsed.png` });
    result.screenshots.push(`stock-card-${width}-collapsed.png`);
    await page.addStyleTag({ content: 'html { font-size: 20.8px !important; }' });
    await measure(width, 1.3, 'collapsed');
    await capture(`stocks-${width}-collapsed-font130`);
    await page.addStyleTag({ content: 'html { font-size: 16px !important; }' });
    if (width === 390) { const closed = page.locator('.div-stock-toggle[aria-expanded="false"]'); while (await closed.count()) await closed.first().click(); }
  }
  assert.equal(await page.locator('.div-stock-toggle[aria-expanded="false"]').count(), 10);
  assert.equal(await page.locator('.div-stock-reading .div-home-plan').count(), 10);
  assert.equal(await page.locator('.div-stock-reading table:visible').count(), 20);
  result.checks.push('Reproduced: all ten stocks collapsed still display all twenty buy/sell grid tables.');
  const first = result.layouts.find(x => x.width === 390 && x.state === 'expanded');
  const collapsed = result.layouts.find(x => x.width === 390 && x.scale === 1 && x.state === 'collapsed');
  result.collapseReductionPercent = Math.round((1 - collapsed.tenCardsHeight / first.tenCardsHeight) * 10000) / 100;
  await page.locator('.div-daily-heading').scrollIntoViewIfNeeded();
  await capture('daily-no-ai-320');
  await page.locator('.div-daily-heading button').click();
  await page.locator('#dividend-advisor-settings').waitFor({ state: 'visible' });
  result.noAiClick = { deterministicChecklistCount: await page.locator('.div-daily-result').count(), settingsVisible: await page.locator('#dividend-advisor-settings').isVisible() };
  await capture('daily-no-ai-opens-settings-320');
  result.checks.push('Without AI configuration, clicking daily advice opens configuration and creates no deterministic daily result.');
} finally {
  await writeFile(`${output}browser-baseline.json`, JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
