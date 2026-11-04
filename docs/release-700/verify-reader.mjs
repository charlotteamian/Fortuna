import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const origin = 'http://127.0.0.1:5198';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const result = { environment: 'Isolated Chrome profile and synthetic local data; external APIs blocked. Browser events simulate app background/resume; not a native-device lifecycle test.', checks: [], errors: [], layouts: [] };
const check = name => result.checks.push({ name, passed: true });
page.on('pageerror', error => result.errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin || /api\//.test(url.pathname)) return route.abort();
  return route.continue();
});
try {
  await page.goto(origin);
  await page.evaluate(async () => {
    const { initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    await initializeSettings();
    await updateSettings({ language: 'zh', amountVisible: true, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION, dividendWorkbenchInitialized: true, dividendBudgetMinor: 1000000, dividendStrategy: 'stocks', themeMode: 'light' });
  });
  await page.reload();
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-home-advisor .div-advisor-entry-actions button').first().click();
  await page.locator('#div-ai-reader-question').waitFor();
  await page.waitForFunction(() => !document.querySelector('#div-ai-reader-question')?.disabled);
  assert.equal(await page.locator('.div-advisor-workspace-tabs button').count(), 3);
  assert.equal(await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name: '计划管理' }).count(), 0);
  check('assistant has a single selection-and-plan tab with no duplicate plan tab');

  await page.locator('#div-ai-reader-question').fill('保留这条未发送的问题');
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name: '选股与计划' }).click();
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name: '选股原则' }).click();
  await page.locator('.div-advisor-reader-scroll').evaluate(element => { element.scrollTop = 150; });
  const previous = await page.locator('.div-advisor-reader-scroll').evaluate(element => element.scrollTop);
  const hashBefore = await page.evaluate(() => location.hash);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.div-advisor-reader').count(), 1);
  assert.equal(await page.locator('.div-advisor-workspace-tabs button[aria-current="page"]').innerText(), '选股原则');
  assert.equal(await page.evaluate(() => location.hash), hashBefore);
  assert.equal(await page.locator('.div-advisor-reader-scroll').evaluate(element => element.scrollTop), previous);
  check('background, pagehide and foreground events preserve current reader route, panel and scroll');
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name: '聊天', exact: true }).click();
  assert.equal(await page.locator('#div-ai-reader-question').inputValue(), '保留这条未发送的问题');
  check('question draft survives tab changes and background/resume');

  for (const width of [320, 390]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(value => document.documentElement.style.setProperty('--font-scale', String(value)), scale);
    const layout = await page.locator('.div-advisor-compose-row').evaluate(element => {
      const textarea = element.querySelector('textarea').getBoundingClientRect();
      const button = element.querySelector('button').getBoundingClientRect();
      const reader = document.querySelector('.div-advisor-reader').getBoundingClientRect();
      return { textarea: { left: textarea.left, right: textarea.right, width: textarea.width, height: textarea.height }, button: { left: button.left, right: button.right, width: button.width, height: button.height }, viewportWidth: innerWidth, readerWidth: reader.width, horizontalOverflow: document.querySelector('.div-advisor-reader-column').scrollWidth > reader.width };
    });
    assert.ok(layout.textarea.width >= 180);
    assert.ok(layout.button.width >= 60);
    assert.ok(layout.textarea.right <= layout.button.left);
    assert.ok(layout.button.right <= width);
    assert.equal(layout.horizontalOverflow, false);
    assert.ok(layout.button.height <= 60);
    result.layouts.push({ width, scale, ...layout });
    await page.screenshot({ path: new URL(`./reader-${width}-${scale}.png`, import.meta.url).pathname });
  }
  check('chat composer stays readable without button wrapping or horizontal overflow at 320/390 pixels and font scaling');
  await page.locator('#div-ai-reader-question').fill('什么是股息率？');
  await page.locator('.div-advisor-reader-compose button[type="submit"]').click();
  await page.locator('.div-advisor-reading-message.assistant').waitFor();
  await page.waitForFunction(() => !document.querySelector('.div-advisor-reading-progress'));
  assert.match(await page.locator('.div-advisor-reading-message.assistant').innerText(), /每股现金分红除以股价/);
  check('unconfigured local chat still returns a readable explanation after navigation changes');
  await page.locator('.div-advisor-back').click();
  await page.waitForFunction(() => !document.querySelector('.div-advisor-reader'));
  check('explicit Back still closes the reader');
  assert.deepEqual(result.errors, []);
  result.success = true;
} finally {
  await writeFile(new URL('./reader-verification.json', import.meta.url), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
