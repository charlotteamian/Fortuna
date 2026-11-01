import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5188', output = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const result = { success: false, environment: 'Fresh isolated Chrome profile; synthetic ledger/research and local AI/quote stubs; all other external network blocked; no real user data or real model.', checks: [], errors: [], screenshots: [], layouts: [], requests: [] };
const check = name => result.checks.push({ name, passed: true });
const fcfText = '自由现金流通常指经营活动现金流减去资本性支出。它帮助理解经营产生的现金在维持必要投资后还剩多少。';
const simpleText = '自由现金流就像经营收到的钱在扣掉必要设备投入后留下的余钱。这里解释现金的来去与结余。';
const roeText = '缺少可核对的完整年度财务口径时，这项指标不能用于可靠比较。季度累计数据不能直接充当全年结果。';
let mode = 'normal', releaseFailure;
const envelope = blocks => JSON.stringify({ version: 1, blocks });
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'stage12-ai.invalid') {
    const body = route.request().postDataJSON();
    const last = body.messages?.at(-1)?.content ?? body.contents?.at(-1)?.parts?.[0]?.text ?? '';
    result.requests.push({ body, mode });
    if (mode === 'delayed_error') {
      await new Promise(resolve => { releaseFailure = resolve; });
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'SYNTHETIC_PRIVATE_PROVIDER_FAILURE' });
    }
    let content;
    if (mode === 'unsafe') content = envelope([{ type: 'concept', text: '自由现金流是赶紧冲，闭眼拿。现在请立即新增买入100股。' }]);
    else if (/换个简单说法/.test(last)) content = envelope([{ type: 'concept', text: simpleText }]);
    else if (/什么是自由现金流/.test(last)) content = envelope([{ type: 'concept', text: fcfText }]);
    else if (/股息率计算例子/.test(last)) content = envelope([{ type: 'example', formula: 'cash_yield', inputs: [0.5, 10] }]);
    else if (/ROE|净资产收益率/.test(last)) content = envelope([{ type: 'evidence', factIds: ['stock:601398:check:roe', 'stock:601398:financial:roe_basis'], text: roeText }]);
    else content = envelope([{ type: 'concept', text: fcfText }]);
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) });
  }
  if (url.origin !== origin) return route.abort();
  if (url.pathname.startsWith('/qt-api/')) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const fields = Array(40).fill(''); fields[1] = '模拟银行'; fields[2] = '601398'; fields[3] = '9'; fields[30] = today.replaceAll('-', '') + '090000'; fields[32] = '0';
    return route.fulfill({ body: `v_sh601398="${fields.join('~')}";` });
  }
  if (/api\//.test(url.pathname)) return route.abort();
  return route.continue();
});
page.on('pageerror', error => result.errors.push(error.message));
const capture = async name => { await page.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`); };
const snapshot = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  return JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
});
const beginAsk = async question => {
  const count = await page.locator('.div-advisor-reading-message.assistant').count();
  await page.locator('#div-ai-reader-question').fill(question);
  await page.locator('.div-advisor-reader-compose').getByRole('button').click();
  await page.waitForFunction(previous => document.querySelectorAll('.div-advisor-reading-message.assistant').length > previous, count);
  return page.locator('.div-advisor-reading-message.assistant').last();
};
const ask = async question => {
  const answer = await beginAsk(question);
  await page.waitForFunction(() => !document.querySelector('.div-advisor-reading-progress'));
  return answer;
};
try {
  await page.goto(origin);
  await page.evaluate(async () => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const { defaultDividendPricingMethod } = await import('/src/lib/dividendPricing.ts');
    const { defaultDividendSelectionPrinciples } = await import('/src/lib/dividendResearch.ts');
    const { saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    const { clearDividendAdvisorConfig } = await import('/src/services/dividendAdvisorService.ts');
    const now = Date.now(), asOf = dateInChina(), principles = defaultDividendSelectionPrinciples(), pricingMethod = defaultDividendPricingMethod();
    await initializeSettings(); await clearDividendAdvisorConfig();
    await updateSettings({ language: 'zh', amountVisible: true, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      dividendWorkbenchInitialized: true, dividendBudgetMinor: 1000000, dividendStrategy: 'stocks', dividendSelectionPrinciples: principles, dividendPricingMethod: pricingMethod, themeMode: 'dark' });
    await db.dividendStocks.put({ code: '601398', name: '模拟银行', group: 'core', weightBps: 10000, shareMode: 'manual', manualShares: 200, lotSize: 100, buyPaused: true,
      buyLevels: [1000, 950, 900, 850].map((priceMinor, i) => ({ priceMinor, yieldBps: [550, 575, 600, 650][i], portionBps: 2500 })),
      sellLevels: [1200, 1250, 1300, 1400].map((priceMinor, i) => ({ priceMinor, yieldBps: [480, 450, 420, 400][i], portionBps: 2500 })),
      dividend: { schemaVersion: 2, dpsMicros: 0, asOf, windowStart: asOf, payments: [], announcements: [], fetchedAt: now } });
    await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now, principles, pricingMethod, indices: [], stocks: [{ code: '601398', name: '模拟银行', status: 'unknown',
      checks: [{ rule: 'roe', status: 'unknown', reason: 'missing', period: '2025-12-31' }], sources: [], issues: [],
      financial: { code: '601398', asOf, financialSector: true, latest: { reportDate: '2026-09-30', roeBps: 500 }, periods: [{ reportDate: '2026-09-30', roeBps: 500 }] } }] } });
  });
  await page.goto(origin); await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-stock-reading').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.div-quote-status button')?.disabled);
  const ledgerBefore = await snapshot();
  await page.locator('.div-home-advisor .div-advisor-entry-actions button').first().click();
  const localDefinition = await ask('什么是股息率？');
  assert.match(await localDefinition.innerText(), /每股现金分红除以股价/);
  assert.equal(result.requests.length, 0);
  const localOperations = await ask('今天怎么操作？');
  assert.match(await localOperations.innerText(), /手动暂停|受限/);
  assert.equal(result.requests.length, 0);
  await capture('unconfigured-local-390');
  check('unconfigured chat remains usable and returns local explanation and deterministic operation check without requesting a model');

  await page.evaluate(async () => {
    const { saveDividendAdvisorConfig } = await import('/src/services/dividendAdvisorService.ts');
    const { DIVIDEND_AI_CONFIG_CHANGED_EVENT } = await import('/src/lib/dividendAdvisorNavigation.ts');
    await saveDividendAdvisorConfig({ protocol: 'openai', baseUrl: 'https://stage12-ai.invalid/v1', model: 'synthetic-explainer', apiKey: 'synthetic-key' });
    window.dispatchEvent(new Event(DIVIDEND_AI_CONFIG_CHANGED_EVENT));
  });
  const fcf = await ask('什么是自由现金流');
  const firstFcfAnswer = await fcf.innerText();
  assert.ok(firstFcfAnswer.includes(fcfText));
  assert.equal(result.requests.length, 1);
  await capture('free-cash-flow-390');
  check('a concept outside the old glossary receives a relevant visible AI explanation');
  const simple = await ask('换个简单说法');
  assert.ok((await simple.innerText()).includes(simpleText));
  assert.notEqual(await simple.innerText(), firstFcfAnswer);
  assert.match(JSON.stringify(result.requests.at(-1).body), /什么是自由现金流/);
  assert.match(JSON.stringify(result.requests.at(-1).body), /经营活动现金流减去资本性支出/);
  await capture('followup-390');
  check('multi-turn simpler-language follow-up receives earlier topic and explanation and returns a different relevant answer');
  const requestsBeforeExample = result.requests.length;
  const example = await ask('举一个股息率计算例子');
  assert.match(await example.innerText(), /假设|示例/); assert.match(await example.innerText(), /5(?:\.0+)?%/);
  assert.equal(result.requests.length, requestsBeforeExample);
  check('local cash-yield arithmetic example is explicitly hypothetical and available without a model request');
  const specified = await ask('请按每股现金分红0.8元和股价20元举一个股息率计算例子');
  assert.match(await specified.innerText(), /0\.8÷20×100%＝4%/);
  assert.doesNotMatch(await specified.innerText(), /0\.5÷10/);
  assert.equal(result.requests.length, requestsBeforeExample);
  await capture('specified-example-390');
  check('actual chat calculates the supplied teaching inputs rather than substituting default numbers');
  const roe = await ask('根据已有资料解释ROE为什么待核实');
  assert.ok((await roe.innerText()).includes(roeText), await roe.innerText());
  assert.match(await roe.innerText(), /ROE|净资产收益率/); assert.match(await roe.innerText(), /缺|未提供|待核/);
  assert.doesNotMatch(await roe.innerText(), /ROE为15%|https:\/\/invented/);
  await capture('roe-evidence-390');
  check('risk explanation cites actual ROE evidence and missing annual/annualisation basis without inventing a report value or source');

  mode = 'delayed_error';
  const countBeforePending = result.requests.length;
  const pendingLocal = await beginAsk('根据已有资料解释ROE为什么待核实，再详细一点');
  await page.waitForFunction(() => document.querySelector('.div-advisor-reading-progress'));
  for (let attempt = 0; attempt < 50 && !releaseFailure; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(result.requests.length, countBeforePending + 1); assert.ok(releaseFailure);
  assert.match(await pendingLocal.innerText(), /ROE|净资产收益率/); assert.match(await pendingLocal.innerText(), /手动暂停|受限/);
  await capture('pending-local-preserved-390');
  releaseFailure(); await page.waitForFunction(() => !document.querySelector('.div-advisor-reading-progress'));
  const failed = page.locator('.div-advisor-reading-message.assistant').last();
  assert.match(await failed.innerText(), /ROE|净资产收益率/); assert.match(await failed.innerText(), /手动暂停|受限/);
  assert.doesNotMatch(await failed.innerText(), /SYNTHETIC_PRIVATE_PROVIDER_FAILURE/);
  await capture('model-failed-local-preserved-390');
  check('local evidence and operation restrictions are visible while AI is pending and survive an HTTP failure');

  mode = 'unsafe';
  const rejected = await ask('根据已有资料解释ROE为什么待核实');
  assert.doesNotMatch(await rejected.innerText(), /赶紧冲|闭眼拿|立即新增买入100股/);
  assert.match(await rejected.innerText(), /ROE|净资产收益率/); assert.match(await rejected.innerText(), /手动暂停|受限/);
  assert.equal(await rejected.locator('.div-ai-plan-actions').count(), 0);
  check('malicious structured explanation cannot leak an action instruction or create a draft reason/action');

  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
    const overflow = await page.locator('.div-advisor-reader').evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
    result.layouts.push({ width, scale, overflow }); assert.deepEqual(overflow, []);
    await capture(`chat-${width}-${scale}`);
  }
  assert.equal(await snapshot(), ledgerBefore, 'read-only conversations never change any main ledger table (conversation history is a separate pre-existing store)');
  check('all main ledger tables, saved prices, holdings and manual pause remain byte-identical across local, AI, follow-up and failure cases');
  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (cause) {
  result.failure = cause.message; await page.screenshot({ path: `${output}browser-failure.png` }); throw cause;
} finally {
  await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
