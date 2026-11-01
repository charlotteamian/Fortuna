import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.FORTUNA_STAGE3_ORIGIN ?? 'http://127.0.0.1:5188';
process.env.FORTUNA_STAGE2_ORIGIN = origin;
const { seed, home, captureTarget, stockCodes } = await import('../../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(new URL('../../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const publicFixture = JSON.parse(await readFile(new URL('../../../scripts/fixtures/dividend-pricing-public-2026-10-21.json', import.meta.url), 'utf8'));
const official = await Promise.all(['pingan-2025-final', 'pingan-2026-interim'].map(name => readFile(new URL(`../../../scripts/fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const opportunity = await readFile(new URL('../../../scripts/fixtures/dividend-index-000922-2026-10-21.xls', import.meta.url));
const result = { success: false, scope: 'Fresh isolated Chrome; synthetic 10-stock / 2-fund database; real local refresh pipeline with HTTP/AI stubs, cached official documents, all external traffic blocked. No real user database, native installation or live services.',
  checks: [], requests: [], errors: [], layouts: [], screenshots: [] };
let mode = 'success', held = [], aiCalls = 0;
const check = name => result.checks.push({ name, passed: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true });
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', error => result.errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-11-01T03:00:00Z'));
const cloneCode = (payload, code) => {
  const data = structuredClone(payload);
  for (const row of data.result?.data ?? []) { row.SECURITY_CODE = code; row.SECURITY_NAME_ABBR = `模拟${code}`; if (row.SECUCODE) row.SECUCODE = `${code}.${code.startsWith('6') ? 'SH' : 'SZ'}`; }
  return data;
};
const hold = () => new Promise(resolve => held.push(resolve));
const release = () => { for (const resolve of held.splice(0)) resolve(); };
const json = (route, value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'stage3-ai.invalid') {
    aiCalls++; return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'SYNTHETIC_PROVIDER_FAILURE' });
  }
  if (url.origin !== origin) return route.abort();
  const isApi = /^\/(qt-api|dividend-(?:api|schedule-api|trend-api|tencent-api|cninfo-api|index-api|document-api))\//.test(url.pathname);
  if (!isApi) return /api\//.test(url.pathname) ? route.abort() : route.continue();
  const query = decodeURIComponent(url.search);
  let code = /SECURITY_CODE[="]+(\d{6})/.exec(query)?.[1] ?? /(?:sz|sh)(\d{6})/i.exec(query)?.[1];
  let fields;
  if (url.pathname.startsWith('/dividend-cninfo-api/')) { fields = new URLSearchParams(route.request().postData() ?? ''); code = fields.get('keyWord') ?? fields.get('stock')?.slice(0, 6); }
  result.requests.push({ path: url.pathname, query: url.search, code, mode });
  if (mode === 'hold_quote' && url.pathname.startsWith('/qt-api/')) await hold();
  if (mode === 'hold_evidence' && /dividend-(?:cninfo-api|schedule-api)/.test(url.pathname)) await hold();
  if (mode === 'all_fail' || mode === 'one_fail' && code === '000003') return route.fulfill({ status: 503, body: 'SYNTHETIC_SOURCE_FAILURE' });
  if (url.pathname.startsWith('/qt-api/')) {
    const codes = (url.pathname.split('q=')[1] ?? '').split(',').map(symbol => symbol.slice(2));
    const body = codes.map(code => {
      const fields = Array(40).fill(''); fields[1] = `模拟${code}`; fields[2] = code; fields[3] = /^5/.test(code) ? '1.2' : '8'; fields[32] = '0';
      fields[30] = `${code === '000005' ? '20261031' : '20261101'}100000`;
      return `v_${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
    }).join('\n');
    return route.fulfill({ body });
  }
  if (url.pathname.startsWith('/dividend-schedule-api/')) return json(route, { fhyx: [] });
  if (url.pathname.startsWith('/dividend-cninfo-api/')) {
    if (url.pathname.endsWith('/query') && fields?.has('keyWord')) return json(route, [{ code, orgId: `synthetic-${code}` }]);
    return json(route, { hasMore: false, announcements: official.map((event, index) => ({ announcementTitle: '模拟年度权益分派实施公告',
      adjunctUrl: `finalpage/${event.announcementDate}/synthetic-${code}-${index}.PDF`, announcementTime: Date.parse(`${event.announcementDate}T00:00:00Z`) })) });
  }
  if (url.pathname.startsWith('/dividend-index-api/')) return route.fulfill({ body: opportunity });
  if (url.pathname.startsWith('/dividend-api/')) {
    const report = url.searchParams.get('reportName') ?? url.searchParams.get('type');
    if (report === 'RPTA_WEB_TREASURYYIELD') return json(route, fixture.sources.treasury.data);
    if (report === 'RPT_DMSK_FN_CASHFLOW') return json(route, cloneCode(publicFixture.sources.cash, code));
    if (report === 'RPT_F10_FINANCE_MAINFINADATA') return json(route, cloneCode(fixture.sources.financial.data, code));
    if (report === 'RPT_SHAREBONUS_DET') return json(route, cloneCode(fixture.sources.distribution.data, code));
  }
  if (/dividend-(trend|tencent)-api/.test(url.pathname)) {
    const symbol = url.searchParams.get('param')?.split(',')[0];
    if (query.includes(',month,')) return json(route, { code: 0, data: { [symbol]: fixture.sources.month.data.data.sz000001 } });
    const rows = Array.from({ length: 90 }, (_, index) => { const date = new Date(Date.parse('2026-11-01T00:00:00Z') - (89 - index) * 86400000).toISOString().slice(0, 10); return [date, '8', '8', '8', '8']; });
    return json(route, { code: 0, data: { [symbol]: { qfqday: rows } } });
  }
  return route.fulfill({ status: 503, body: 'UNHANDLED_SYNTHETIC_SOURCE' });
});
const savedCheck = () => page.evaluate(async () => (await (await import('/src/services/dividendDailyAdviceService.ts')).loadDividendDailyChecks()).current);
const snapshot = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  const data = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  data.dividendStocks = data.dividendStocks.map(stock => { for (const key of ['quote', 'quoteFailedAt', 'dividend', 'dividendFailedAt', 'trend', 'trendFailedAt']) delete stock[key]; return stock; });
  for (const setting of data.settings) if (setting.dividendFundPlan) setting.dividendFundPlan.funds = setting.dividendFundPlan.funds.map(fund => { delete fund.quote; delete fund.quoteFailedAt; return fund; });
  return data;
});
const finish = async expected => {
  await page.waitForFunction(async expected => { const { current } = await (await import('/src/services/dividendDailyAdviceService.ts')).loadDividendDailyChecks(); return current && current.status !== 'running' && (!expected || current.status === expected); }, expected);
  await page.locator('.div-daily-generate:not([disabled])').waitFor(); return savedCheck();
};
const clickCheck = async () => { await page.locator('.div-daily-generate').click(); await page.locator('.div-daily-result').waitFor(); };
const capture = async name => { await page.locator('.div-daily-advice').evaluate(element => element.scrollIntoView({ block: 'start' })); await page.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`); };
try {
  await seed(page);
  await page.evaluate(async ({ official, stockCodes }) => {
    const { db } = await import('/src/db.ts');
    const { parseDividendOfficialAnnouncementText } = await import('/src/lib/dividendLedger.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const store = new Dexie('FortunaDividendLedger'); store.version(1).stores({ documents: 'url', ledgers: 'code' });
    for (const code of stockCodes) for (const [index, { text, ...metadata }] of official.entries()) {
      const url = `https://static.cninfo.com.cn/finalpage/${metadata.announcementDate}/synthetic-${code}-${index}.PDF`;
      const event = { ...parseDividendOfficialAnnouncementText(text, metadata), code, sourceUrl: url };
      await store.table('documents').put({ url, sha256: `synthetic-${code}-${index}`, checkedAt: metadata.verifiedAt, event });
    }
    store.close();
    const setting = await db.settings.get('main'); const funds = setting.dividendFundPlan.funds.map(fund => fund.id === 'fund-unknown' ? { ...fund, code: '515180', name: '模拟确认零基金' } : fund);
    await db.settings.update('main', { dividendFundPlan: { ...setting.dividendFundPlan, funds } });
  }, { official, stockCodes });
  await home(page); await page.locator('.div-daily-generate:not([disabled])').waitFor();
  const original = await snapshot();
  await clickCheck(); const completed = await finish('completed');
  assert.equal(completed.items.length, 12); assert.equal(completed.checkedKeys.length, 12); assert.equal(aiCalls, 0);
  assert.deepEqual(await snapshot(), original); assert.ok(completed.items.every(item => item.reasons.length <= 3));
  assert.ok(completed.items.some(item => item.kind === 'stock') && completed.items.some(item => item.kind === 'fund'));
  assert.equal(await page.locator('.div-daily-advice table').count(), 0);
  assert.equal(await page.locator('.div-ai-settings-page').count(), 0);
  check('actual Check today button completes all 12 stock/fund plans without AI, without settings redirect or business writes');
  const paused = completed.items.find(item => item.key === 'stock:000001');
  assert.equal(paused.trigger, 'triggered'); assert.equal(paused.actions.buy.status, 'blocked'); assert.equal(paused.bucket, 'review');
  assert.equal(completed.items.find(item => item.key === 'stock:000005').quote.status, 'last_available');
  assert.ok(completed.items.every(item => item.quote.sessionConfirmed === false));
  assert.ok(completed.items.flatMap(item => item.dates.evidenceVerifiedDates).every(date => date === '2026-10-29'));
  check('manual pause, failed principles, historical quotes, original document dates and unverified execution session remain separate');
  await capture('completed-390');

  for (const width of [320, 390]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(scale => document.documentElement.style.fontSize = `${16 * scale}px`, scale);
    const overflow = await page.locator('.div-daily-advice').evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
    assert.deepEqual(overflow, []); result.layouts.push({ width, scale, overflow }); await capture(`check-${width}-${scale}`);
  }
  check('320/390px and 1x/1.3x font show usable compact rows, cancellation/retry controls and no horizontal overflow');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.style.fontSize = '16px');
  await page.locator('.div-daily-result [data-check-key="stock:000001"]').getByRole('button', { name: '原计划与依据 ↗' }).click();
  await page.locator('[id="div-check-stock:000001"] .div-check-status-evidence[open]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('[id="div-check-stock:000001"] .div-check-status-evidence').getAttribute('open'), '');
  check('a row navigates to its actual original plan evidence without writing a price or pause');

  await page.evaluate(async () => {
    const { saveDividendAdvisorConfig } = await import('/src/services/dividendAdvisorService.ts');
    const { DIVIDEND_AI_CONFIG_CHANGED_EVENT } = await import('/src/lib/dividendAdvisorNavigation.ts');
    await saveDividendAdvisorConfig({ protocol: 'openai', baseUrl: 'https://stage3-ai.invalid/v1', apiKey: 'synthetic-token', model: 'synthetic-model' });
    window.dispatchEvent(new CustomEvent(DIVIDEND_AI_CONFIG_CHANGED_EVENT));
  });
  await page.locator('.div-daily-explanation').getByRole('button', { name: '按需解释已有依据' }).click();
  await page.locator('.div-daily-explanation .div-advisor-markdown').waitFor();
  await page.waitForFunction(() => !document.querySelector('.div-daily-explanation button')?.disabled);
  assert.equal(aiCalls, 1); assert.deepEqual((await savedCheck()).items, completed.items); assert.deepEqual(await snapshot(), original);
  check('optional AI HTTP failure retains local explanation and the complete deterministic list without machine actions');
  await capture('ai-failed-list-preserved-390');

  mode = 'one_fail'; await clickCheck(); const partial = await finish('partial');
  assert.equal(partial.checkedKeys.length, 12); assert.equal(partial.items.length, 12);
  assert.ok(partial.sources.some(source => source.itemKey === 'stock:000003' && source.status === 'failed'));
  assert.equal(await page.locator('.div-daily-previous').count(), 1); assert.deepEqual(await snapshot(), original);
  check('one bad stock does not block other items; partial results and last completed batch are kept separately');
  await capture('partial-390');
  mode = 'success'; const beforeRetry = result.requests.length;
  await page.locator('.div-daily-result [data-check-key="stock:000003"] .div-daily-retry').click(); const retried = await finish('completed');
  const retryRequests = result.requests.slice(beforeRetry);
  assert.ok(retryRequests.every(request => !request.code || request.code === '000003'));
  assert.ok(retryRequests.filter(request => request.path.startsWith('/qt-api/')).every(request => !request.path.includes(',')));
  for (const item of partial.items.filter(item => item.key !== 'stock:000003')) assert.deepEqual(retried.items.find(row => row.key === item.key), item);
  check('actual per-item Retry requests only the selected failed stock and retains every other result and check time');

  mode = 'one_fail'; await clickCheck(); await finish('partial');
  const yesterday = Date.parse('2026-10-31T03:00:00Z');
  await page.evaluate(async yesterday => {
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const store = new Dexie('FortunaDividendDailyAdvice'); store.version(1).stores({ advice: 'id' });
    const row = await store.table('advice').get('check:current');
    row.check.startedAt = yesterday; row.check.finishedAt = yesterday;
    row.check.items.forEach(item => { item.checkedAt = yesterday; });
    row.check.sources.forEach(source => { source.attemptedAt = yesterday; });
    await store.table('advice').put(row); store.close();
  }, yesterday);
  await home(page); mode = 'success'; const crossDayBefore = result.requests.length;
  await page.locator('.div-daily-result [data-check-key="stock:000003"] .div-daily-retry').click();
  const crossDay = await finish('partial');
  assert.deepEqual(crossDay.checkedKeys, ['stock:000003']);
  assert.ok(crossDay.items.filter(item => item.key !== 'stock:000003').every(item => item.stale && item.checkedAt === yesterday));
  assert.ok(crossDay.sources.filter(source => source.itemKey !== 'stock:000003').every(source => source.historical && source.attemptedAt === yesterday));
  assert.ok(result.requests.slice(crossDayBefore).every(request => !request.code || request.code === '000003'));
  assert.match(await page.locator('.div-daily-stage-details > summary').innerText(), /已核对 1 \/ 12/);
  assert.equal(await page.locator('.div-daily-explanation button').first().isDisabled(), true);
  assert.match(await page.locator('.div-daily-result').innerText(), /需重新检查/);
  await page.locator('.div-daily-sources > summary').click();
  assert.match(await page.locator('.div-daily-sources').innerText(), /历史资料，本轮未重新核对/);
  assert.deepEqual(await snapshot(), original);
  check('cross-day UI Retry checks only the selected item; 11 old times and historical sources remain visible, today count is 1/12, and explanation is disabled');
  await capture('cross-day-retry-390');

  mode = 'hold_quote'; const beforeCancel = await snapshot(); await clickCheck();
  await page.waitForFunction(() => document.querySelector('.div-daily-cancel'));
  for (let attempt = 0; attempt < 50 && !held.length; attempt++) await page.waitForTimeout(10);
  assert.ok(held.length); await page.locator('.div-daily-cancel').click(); const cancelled = await finish('cancelled');
  assert.equal(cancelled.items.length, 12); const cancelledId = cancelled.batchId;
  release(); await page.waitForTimeout(100); assert.equal((await savedCheck()).batchId, cancelledId); assert.deepEqual(await snapshot(), beforeCancel);
  assert.match(await page.locator('.div-daily-result').innerText(), /无法中止.*迟到响应和写入已隔离/s);
  check('Cancel aborts the quote-stage batch; releasing late HTTP replies cannot change business data or replace its cancelled result');
  await capture('cancelled-390');

  await page.evaluate(async () => {
    const { dividendDailyCheckRunner } = await import('/src/services/dividendDailyCheckService.ts');
    const original = dividendDailyCheckRunner.run; window.__stage3Run = original;
    dividendDailyCheckRunner.run = options => original({ ...options, timeoutMs: 120 });
  });
  mode = 'hold_quote'; await clickCheck(); await finish('timed_out'); release();
  await page.evaluate(async () => { (await import('/src/services/dividendDailyCheckService.ts')).dividendDailyCheckRunner.run = window.__stage3Run; });
  check('the real UI reaches a timeout with the same pipeline and an injected shorter test deadline; no later stages start');
  await capture('timed-out-390');

  mode = 'hold_evidence'; await clickCheck();
  for (let attempt = 0; attempt < 100 && !held.length; attempt++) await page.waitForTimeout(10);
  assert.ok(held.length);
  await page.evaluate(async () => { const { db } = await import('/src/db.ts'); const stock = await db.dividendStocks.get('000001'); await db.dividendStocks.update('000001', { note: 'Synthetic user edit during check', manualShares: 777, buyLevels: stock.buyLevels.map((level, index) => index ? level : { ...level, priceMinor: 999 }) }); });
  release(); await finish('changed');
  const edited = await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.get('000001'));
  assert.equal(edited.manualShares, 777); assert.equal(edited.buyLevels[0].priceMinor, 999); assert.equal(edited.buyPaused, true);
  check('a plan/holding edit during the announcement stage cancels stale writes and preserves the user’s new values');
  await capture('inputs-changed-390');

  mode = 'success'; await clickCheck(); await finish('completed');
  mode = 'all_fail'; const offlineBefore = await snapshot(); await clickCheck(); const offline = await finish('partial');
  assert.equal(offline.items.length, 12); assert.equal(offline.checkedKeys.length, 12); assert.deepEqual(await snapshot(), offlineBefore);
  assert.ok(offline.items.some(item => item.quote.date)); assert.ok(offline.sources.some(source => source.status === 'failed'));
  assert.ok(offline.items.flatMap(item => item.dates.evidenceVerifiedDates).every(date => date === '2026-10-29'));
  check('all HTTP sources failing still return every deterministic item with historical prices, original dates and explicit source gaps');
  await page.locator('.div-daily-sources > summary').click(); await capture('all-failed-sources-390');

  mode = 'hold_quote'; await clickCheck(); await page.locator('.div-daily-cancel').waitFor();
  await page.locator('.tab-bar button').first().click(); release();
  await page.waitForFunction(async () => (await (await import('/src/services/dividendDailyAdviceService.ts')).loadDividendDailyChecks()).current?.status === 'cancelled');
  mode = 'success'; await home(page); assert.match(await page.locator('.div-daily-result-heading').innerText(), /本轮已取消/);
  check('leaving the page cancels the batch and reopening restores its partial/cancelled result alongside the last completion');

  await page.evaluate(async () => { const { saveDividendDailyAdvice } = await import('/src/services/dividendDailyAdviceService.ts'); await saveDividendDailyAdvice({ answer: '旧版本保留的模拟建议', generatedAt: '2026-10-31T03:00:00Z', language: 'zh', planKey: 'legacy', refreshLimited: true }); });
  await home(page); await page.locator('.div-daily-legacy > summary').click(); assert.match(await page.locator('.div-daily-legacy').innerText(), /旧版本保留的模拟建议/);
  check('legacy advice remains readable, explicitly historical, without becoming a current check or changing the backup schema');

  const ownership = await page.evaluate(async () => {
    const { createDividendDailyCheckRunner, loadDividendDailyCheckSnapshot } = await import('/src/services/dividendDailyCheckService.ts');
    const { claimDividendDailyCheckBatch, loadDividendDailyCheckOwner, loadDividendDailyChecks, saveDividendDailyCheck } = await import('/src/services/dividendDailyAdviceService.ts');
    const snapshot = await loadDividendDailyCheckSnapshot();
    let release, entered, oldRefreshes = 0;
    const gate = new Promise(resolve => { release = resolve; }), reading = new Promise(resolve => { entered = resolve; });
    const deps = { load: async () => structuredClone(snapshot), inputKey: async () => snapshot.inputKey,
      claim: claimDividendDailyCheckBatch, owner: loadDividendDailyCheckOwner, save: saveDividendDailyCheck,
      refresh: async (_progress, options) => {
        for (const item of snapshot.items) {
          for (const kind of item.kind === 'stock' ? ['quote', 'disclosure', 'schedule', 'research', 'official', 'plan'] : ['quote', 'reference', 'plan']) {
            const stage = kind === 'quote' ? 'quotes' : kind === 'plan' ? 'plans' : 'evidence';
            await options.onEvent({ stage, source: { id: `${item.key}:${kind}`, itemKey: item.key, stage, provider: 'isolated-owner-test', status: 'success', attemptedAt: Date.now() } });
          }
          await options.onEvent({ stage: 'plans', checkedKeys: [item.key] });
        }
      } };
    const a = createDividendDailyCheckRunner({ ...deps, load: async () => { entered(); await gate; return structuredClone(snapshot); }, refresh: async () => { oldRefreshes++; } });
    const old = a.run(); await reading;
    const newer = await createDividendDailyCheckRunner(deps).run(); release(); const older = await old;
    const saved = await loadDividendDailyChecks();
    return { newer: newer.batchId, status: newer.status, older: older.status, oldRefreshes, current: saved.current?.batchId, completed: saved.completed?.batchId,
      sameMillisecond: newer.startedAt === older.startedAt };
  });
  assert.equal(ownership.status, 'completed'); assert.equal(ownership.older, 'cancelled'); assert.equal(ownership.oldRefreshes, 0);
  assert.equal(ownership.current, ownership.newer); assert.equal(ownership.completed, ownership.newer); assert.equal(ownership.sameMillisecond, true);
  check('two independent runners sharing browser IndexedDB and identical millisecond starts keep the newer current/completed batch after the old initial read arrives');
  assert.equal(result.errors.length, 0); result.success = true;
} catch (error) {
  result.failure = { message: error.message, stack: error.stack }; await page.screenshot({ path: `${output}failure.png`, fullPage: true }).catch(() => undefined); throw error;
} finally {
  release(); await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2) + '\n'); await context.close(); await browser.close();
}
