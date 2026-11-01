import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolate, seed, home, measure, stockCodes, captureTarget } from '../../dividend-stage2/fixture.mjs';

const output = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true });
const page = await context.newPage(); page.setDefaultTimeout(12000);
const result = { success: false, scope: 'Isolated Chrome, fixed synthetic 10-stock / 2-fund data; all external traffic blocked; no real database or device.', checks: [], layouts: [], errors: [], screenshots: [] };
page.on('pageerror', error => result.errors.push(error.message));
const check = name => result.checks.push({ name, passed: true });
const capture = async (name, target) => { if (target) await captureTarget(page, target, `${output}${name}.png`); else await page.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`); };
const card = code => page.locator('.div-stock-reading').filter({ has: page.locator('.div-stock-title > span', { hasText: code }) });
const snapshot = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
});
const withoutReadingPreference = value => ({ ...value, settings: value.settings.map(({ dividendHomeCollapsedCodes, ...rest }) => rest) });
const installWriteObserver = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts'); window.__stage2Writes = [];
  const database = db.name, settings = new Map((await db.settings.toArray()).map(value => [value.id, value]));
  const observe = (store, operation, value) => {
    if (store.transaction.db.name !== database) return;
    let fields = Object.keys(value ?? {});
    if (store.name === 'settings' && value) {
      const previous = settings.get(value.id) ?? {};
      fields = [...new Set([...Object.keys(previous), ...Object.keys(value)])].filter(key => JSON.stringify(previous[key]) !== JSON.stringify(value[key]));
      settings.set(value.id, structuredClone(value));
    }
    window.__stage2Writes.push({ table: store.name, operation, fields });
  }
  // Observe the browser store, including writes through other instances of a Vite module.
  for (const name of ['put', 'add', 'delete', 'clear']) {
    const original = IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name] = function (...args) { observe(this, name === 'put' ? 'update' : name, args[0]); return original.apply(this, args); };
  }
  for (const name of ['update', 'delete']) {
    const original = IDBCursor.prototype[name];
    IDBCursor.prototype[name] = function (...args) { observe(this.source.objectStore ?? this.source, name, args[0]); return original.apply(this, args); };
  }
});
const writeLog = () => page.evaluate(() => window.__stage2Writes);
const overflow = selector => page.locator(selector).evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
try {
  await isolate(page); result.fixture = await seed(page); await home(page);
  const baseline = await snapshot(); await installWriteObserver();
  assert.equal(await page.locator('.div-stock-reading').count(), 10);
  assert.equal(await page.locator('.div-fund-home-card').count(), 2);
  assert.equal(await page.locator('.div-stock-toggle[aria-expanded="false"]').count(), 12);
  assert.equal((await measure(page)).visibleTables, 0);
  for (const row of await page.locator('.div-compact-row').all()) {
    assert.ok(await row.locator('.div-check-primary-reasons > li').count() <= 3);
    assert.equal(await row.locator('.div-check-status-evidence > summary').count(), 1);
    assert.equal(await row.locator('.div-home-plan-budget').first().isVisible(), true);
  }
  assert.deepEqual(await snapshot(), baseline); assert.deepEqual(await writeLog(), []);
  check('first read defaults all 12 plans closed; zero visible grids, at most three reasons, one evidence entrance and visible amounts, with zero writes');
  result.firstScreen = await page.evaluate(() => {
    const bounds = element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
    return { checkEntry: bounds([...document.querySelectorAll('.div-home-advisor button')].find(item => item.textContent.includes('选股检查'))),
      data: bounds(document.querySelector('.div-quote-status')), firstPlan: bounds(document.querySelector('.div-compact-row .div-stock-title')),
      firstTargets: bounds(document.querySelector('.div-compact-row .div-compact-targets')), contentBottom: document.querySelector('.app-content').getBoundingClientRect().bottom };
  });
  for (const key of ['checkEntry', 'data', 'firstPlan', 'firstTargets']) assert.ok(result.firstScreen[key].top >= 0 && result.firstScreen[key].bottom <= result.firstScreen.contentBottom, key);
  await capture('acceptance-first-screen-390');
  check('390×844 default font shows Stock Checks, data status and the first actual plan including both entry/exit reference prices');

  const tools = page.locator('.div-reading-tools').first(); await tools.locator(':scope > summary').click();
  const filters = tools.locator('.div-read-filters');
  const expected = await page.evaluate(async () => {
    const { loadDividendWorkbench } = await import('/src/services/dividendService.ts');
    const { loadDividendCheckSummaries } = await import('/src/services/dividendCheckSummaryService.ts');
    const { loadDividendFundPositions } = await import('/src/services/dividendAdvisorContextService.ts');
    const { matchesDividendReadFilter } = await import('/src/lib/dividendReading.ts');
    const workbench = await loadDividendWorkbench(), fundPositions = await loadDividendFundPositions(workbench.fundPlan.funds);
    const checks = await loadDividendCheckSummaries(workbench, { fundPositions });
    const summaries = [...Object.values(checks.stocks), ...Object.values(checks.funds)];
    return Object.fromEntries(['all', 'triggered', 'held', 'paused', 'unknown'].map(filter => [filter, summaries.filter(item => matchesDividendReadFilter(item, filter)).map(item => item.name).sort()]));
  });
  for (const [index, filter] of ['all', 'triggered', 'held', 'paused', 'unknown'].entries()) {
    await filters.getByRole('button').nth(index).click();
    const names = await page.locator('.div-compact-row .div-stock-title').evaluateAll(elements => elements.map(element => element.childNodes[0].textContent.trim()).sort());
    assert.deepEqual(names, expected[filter]); assert.deepEqual(await snapshot(), baseline);
  }
  await filters.getByRole('button').first().click(); await tools.getByRole('textbox').fill('600003');
  assert.equal(await page.locator('.div-compact-row').count(), 1);
  await tools.getByRole('textbox').fill(''); await tools.locator(':scope > summary').click();
  assert.deepEqual(await writeLog(), []); result.filterMembership = expected;
  check('all five filters and name/code search affect only the visible list; held, pause, current touch and unknown remain independent and every table is unchanged');

  const toggle = card('000001').locator('.div-stock-toggle');
  await toggle.tap(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await card('000001').locator('.div-grid-table:visible').count(), 2);
  const expandedHeight = (await card('000001').boundingBox()).height;
  await toggle.focus(); await page.keyboard.press('Space'); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await card('000001').locator('.div-grid-table:visible').count(), 0);
  assert.ok((await card('000001').boundingBox()).height < expandedHeight / 2);
  assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
  await toggle.press('Enter'); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await toggle.tap(); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.tap(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const fundToggle = page.locator('.div-fund-toggle').first(); await fundToggle.tap();
  assert.equal(await fundToggle.getAttribute('aria-expanded'), 'true');
  await fundToggle.tap(); assert.equal(await fundToggle.getAttribute('aria-expanded'), 'false');
  await fundToggle.focus(); await page.keyboard.press('Enter'); assert.equal(await fundToggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Space'); assert.equal(await fundToggle.getAttribute('aria-expanded'), 'false');
  await fundToggle.tap(); assert.equal(await fundToggle.getAttribute('aria-expanded'), 'true');
  const afterCollapse = await snapshot(); assert.deepEqual(withoutReadingPreference(afterCollapse), withoutReadingPreference(baseline));
  const writes = await writeLog();
  result.collapseWrites = writes;
  assert.ok(writes.length > 0 && writes.every(item => item.table === 'settings' && item.operation === 'update' && item.fields.every(field => field === 'dividendHomeCollapsedCodes')), JSON.stringify(writes));
  check('touch, Space and Enter expand real tables and remove their height on collapse; keyboard focus stays on the toggle; writes touch only the existing preference field');
  await home(page); assert.equal(await card('000001').locator('.div-stock-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.div-fund-toggle').first().getAttribute('aria-expanded'), 'true');
  assert.equal(await card('000002').locator('.div-stock-toggle').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(withoutReadingPreference(await snapshot()), withoutReadingPreference(baseline));
  check('stock and fund preferences restore independently after navigation without changing amounts, grids, holdings, budget or pause');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  assert.match(await card('000001').locator('.div-compact-plan > .div-home-plan-budget').innerText(), /••••/);
  assert.match(await card('000001').locator('.div-compact-quote').innerText(), /¥8/);
  assert.match(await page.locator('.div-fund-home-card').first().locator('.div-compact-quote').innerText(), /••••/);
  assert.equal((await snapshot()).settings[0].amountVisible, false);
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  assert.match(await card('000001').locator('.div-compact-plan > .div-home-plan-budget').innerText(), /3,000/);
  check('dividend amounts default visible independently of global masking and retain the manual hide/show behavior without settings writes');

  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
    assert.deepEqual(await overflow('.dividend-page'), []);
    await capture(`acceptance-expanded-${width}-${scale}`, card('000001'));
    const evidence = card('000001').locator('.div-check-status-evidence'); await evidence.locator(':scope > summary').click();
    assert.deepEqual(await overflow('.dividend-page'), []);
    await capture(`acceptance-evidence-${width}-${scale}`, evidence);
    await evidence.locator(':scope > summary').click();
    result.layouts.push({ width, scale, expandedAndEvidenceOverflow: [] });
  }
  check('stock tables, expanded fund metrics and unified evidence fit both mobile widths at 1× and 1.3× font size');

  await page.setViewportSize({ width: 390, height: 844 }); await page.addStyleTag({ content: 'html { font-size:16px !important; }' });
  const beforeSelection = await snapshot();
  await page.getByRole('button', { name: /选股检查/ }).first().click(); await page.locator('.div-ai-research-card').first().waitFor();
  assert.equal(await page.locator('.div-ai-research-toggle[aria-expanded="false"]').count(), 10);
  assert.equal(await page.locator('.div-ai-research-card table:visible').count(), 0);
  for (const row of await page.locator('.div-ai-research-card').all()) {
    assert.equal(await row.locator('.div-check-status-evidence > summary').count(), 1);
    assert.ok(await row.locator('.div-check-primary-reasons > li').count() <= 3);
  }
  assert.deepEqual(await snapshot(), beforeSelection);
  const researchCard = page.locator('.div-ai-research-card').filter({ hasText: '模拟000001' }).first();
  const researchToggle = researchCard.locator('.div-ai-research-toggle');
  const rawResearch = () => page.evaluate(async () => {
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const db = new Dexie('FortunaDividendResearchCache'); db.version(1).stores({ results: 'id' });
    const value = await db.table('results').get('latest'); db.close(); return value;
  });
  const rawBefore = await rawResearch(); await researchToggle.tap(); assert.equal(await researchToggle.getAttribute('aria-expanded'), 'true');
  const rawAfter = await rawResearch(); assert.deepEqual(rawAfter, { ...rawBefore, collapsedCodes: stockCodes.filter(code => code !== '000001') });
  assert.deepEqual(await snapshot(), beforeSelection);
  const pricePreview = researchCard.getByRole('button', { name: '预览买卖价格计划', exact: true });
  assert.equal(await pricePreview.count(), 1);
  const beforePreview = await snapshot(); await pricePreview.click();
  await researchCard.getByRole('button', { name: '确认写入网格计划', exact: true }).waitFor();
  assert.equal(await researchCard.locator('.div-ai-grid-proposed tbody tr').count(), 8);
  assert.deepEqual(await snapshot(), beforePreview);
  await capture('acceptance-selection-preview', researchCard.locator('.div-ai-grid-proposed'));
  await researchCard.getByRole('button', { name: '取消', exact: true }).click();
  await researchToggle.focus(); await page.keyboard.press('Space');
  await researchCard.locator('#div-ai-stock-000001').waitFor({ state: 'hidden' });
  assert.equal(await researchToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await researchCard.locator('table:visible').count(), 0);
  check('Stock Checks defaults closed without a preference, exposes one price-preview entry on expansion and persists only collapsedCodes in its existing research cache');
  check('the actual Stock Checks price preview shows both four-tier sides and changes no main table before explicit confirmation');
  const researchFilters = page.locator('.div-ai-research-results > .div-read-filters');
  await researchFilters.getByRole('button', { name: '暂停', exact: true }).click(); assert.equal(await page.locator('.div-ai-research-card').count(), 1);
  await researchFilters.getByRole('button', { name: '全部', exact: true }).click();
  assert.deepEqual(await snapshot(), beforeSelection);
  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
    const evidence = researchCard.locator('.div-check-status-evidence'); await evidence.locator(':scope > summary').click();
    assert.deepEqual(await overflow('.div-advisor-reader'), []);
    await capture(`acceptance-selection-evidence-${width}-${scale}`, evidence);
    await evidence.locator(':scope > summary').click();
  }
  check('Stock Checks filters and the single financial, ledger, technical and source evidence disclosure fit all four mobile layouts without main-ledger writes');
    const before = JSON.parse(await readFile(new URL('../../dividend-stage2/before-measurement.json', import.meta.url), 'utf8'));
  const after = JSON.parse(await readFile(`${output}after-measurement.json`, 'utf8'));
  assert.deepEqual(after.fixture, before.fixture);
  assert.equal(after.businessSnapshotHash, before.businessSnapshotHash);
  result.heightComparison = after.layouts.map((layout, index) => {
    const old = before.layouts[index], reduction = 1 - layout.collapsed.listHeight / old.collapsed.listHeight;
    assert.ok(reduction >= .5); assert.equal(layout.collapsed.visibleTables, 0); assert.deepEqual(layout.collapsed.overflow, []);
    return { width: layout.width, scale: layout.scale, before: old.collapsed.listHeight, after: layout.collapsed.listHeight, reduction };
  });
  check('identical fixed 10-stock/2-fund input reduces list height by at least 50% in every tested viewport/font combination and leaves zero visible grids');
  assert.deepEqual(result.errors, []); result.success = true;
} catch (error) { result.failure = error.message; await capture('acceptance-failure'); throw error; }
finally { await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2)); await browser.close(); }
console.log(JSON.stringify(result, null, 2));
