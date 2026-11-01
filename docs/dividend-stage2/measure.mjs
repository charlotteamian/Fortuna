import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { isolate, seed, home, measure, captureTarget } from './fixture.mjs';
const label = process.argv[2] ?? 'before';
const output = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const results = { label, sample: '10 stocks + 2 funds; 2026-11-01 11:00 fixed clock; isolated synthetic data', layouts: [], errors: [] };
page.on('pageerror', error => results.errors.push(error.message));
try {
  await isolate(page); results.fixture = await seed(page, { preferences: label === 'before' }); await home(page);
  results.businessSnapshotHash = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const main = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
    for (const settings of main.settings) delete settings.dividendHomeCollapsedCodes;
    const research = new Dexie('FortunaDividendResearchCache'); research.version(1).stores({ results: 'id' });
    const cache = await research.table('results').get('latest'); delete cache.collapsedCodes; research.close();
    const evidence = new Dexie('FortunaDividendLedger'); evidence.version(1).stores({ documents: 'url', ledgers: 'code' });
    const ledgers = await evidence.table('ledgers').toArray(); evidence.close();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ main, cache, ledgers })));
    return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
  });
  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 });
    await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
    await page.locator('.app-content').evaluate(element => { element.scrollTop = 0; });
    results.layouts.push({ width, scale, collapsed: await measure(page) });
    await page.screenshot({ path: `${output}${label}-home-${width}-${scale}.png` });
    const fullStyle = await page.addStyleTag({ content: 'html.stage2-capture, .stage2-capture body, .stage2-capture #root, .stage2-capture .app { height:auto; overflow:visible; } .stage2-capture .app-content { flex:none; height:auto; max-height:none; overflow:visible; } .stage2-capture .tab-bar { display:none; }' });
    await page.evaluate(() => document.documentElement.classList.add('stage2-capture'));
    await page.screenshot({ path: `${output}${label}-full-${width}-${scale}.png`, fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('stage2-capture'));
    await fullStyle.evaluate(element => element.remove());
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.addStyleTag({ content: 'html { font-size:16px !important; }' });
  for (const button of await page.locator('.div-stock-toggle').all()) if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  results.expanded = await measure(page);
  await captureTarget(page, page.locator('.div-stock-reading').first(), `${output}${label}-expanded-stock.png`);
  await page.getByRole('button', { name: /选股检查/ }).first().click();
  await page.locator('.div-ai-research-card').first().waitFor();
  results.selection = await page.locator('.div-ai-research-card').evaluateAll(cards => cards.map(element => ({ code: element.querySelector('header small')?.textContent, height: element.getBoundingClientRect().height })));
  await page.screenshot({ path: `${output}${label}-selection.png` });
  for (const button of await page.locator('.div-ai-research-toggle').all()) if (await button.getAttribute('aria-expanded') === 'false') {
    const id = await button.getAttribute('aria-controls');
    await button.click(); await page.locator(`[id="${id}"]`).waitFor({ state: 'visible' });
  }
  results.selectionExpanded = await page.locator('.div-ai-research-card').evaluateAll(cards => cards.map(element => ({ code: element.querySelector('header small')?.textContent, height: element.getBoundingClientRect().height })));
  await captureTarget(page, page.locator('.div-ai-research-card').first(), `${output}${label}-selection-expanded.png`);
} finally { await writeFile(`${output}${label}-measurement.json`, JSON.stringify(results, null, 2)); await browser.close(); }
console.log(JSON.stringify({ label, layouts: results.layouts, errors: results.errors }));
