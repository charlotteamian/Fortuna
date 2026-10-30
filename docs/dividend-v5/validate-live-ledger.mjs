import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async raw => {
    const { researchDividendLedger } = await import('/src/services/dividendLedgerEvidenceService.ts');
    const { dividendLedgerBase } = await import('/src/lib/dividendLedger.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const ledger = await researchDividendLedger(raw, '000001', dateInChina());
    const documents = async () => new Promise((resolve, reject) => {
      const request = indexedDB.open('FortunaDividendLedger'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const database = request.result, read = database.transaction('documents').objectStore('documents').getAll();
        read.onsuccess = () => { resolve(read.result); database.close(); }; read.onerror = () => { reject(read.error); database.close(); }; };
    });
    const before = await documents();
    const continued = await researchDividendLedger(raw, '000001', dateInChina());
    const after = await documents();
    const immutable = before.filter(document => document.event).every(document => {
      const current = after.find(value => value.url === document.url);
      return current && document.sha256 === current.sha256 && document.checkedAt === current.checkedAt && document.event.verifiedAt === current.event.verifiedAt;
    });
    return { ledger: continued, base: dividendLedgerBase(continued, continued.asOf), firstPassIssues: ledger.issues,
      verifiedDocuments: after.filter(document => document.event).map(({ url, sha256, checkedAt, event }) => ({ url, sha256, checkedAt, verifiedAt: event.verifiedAt })), immutableVerifiedDocuments: immutable, errors: [] };
  }, fixture.sources.distribution.data);
  await writeFile(new URL('./live-ledger-result.json', import.meta.url), JSON.stringify({ ...result, errors, environment: 'Isolated browser, real CNinfo announcement/PDF requests, archived Eastmoney fixture' }, null, 2) + '\n');
  assert.equal(result.base.dpsMicros, 609000); assert.equal(result.base.verified, true); assert.equal(result.base.frequency, 'semiannual');
  assert.equal(result.ledger.events.filter(event => result.base.selectedBatchIds.includes(event.batchId)).every(event => event.verification === 'verified'), true);
  assert.deepEqual(errors, []); assert.equal(result.immutableVerifiedDocuments, true);
  const interim = result.verifiedDocuments.find(document => document.url.endsWith('/1225568476.PDF'));
  const annual = result.verifiedDocuments.find(document => document.url.endsWith('/1225352449.PDF'));
  const expectedInterim = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-official/pingan-2026-interim.json', import.meta.url), 'utf8'));
  const expectedAnnual = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-official/pingan-2025-final.json', import.meta.url), 'utf8'));
  assert.equal(interim.sha256, expectedInterim.pdfSha256); assert.equal(annual.sha256, expectedAnnual.pdfSha256);
  console.log(JSON.stringify({ base: result.base, verified: result.ledger.events.filter(event => event.verification === 'verified').length, issues: result.ledger.issues }));
} finally { await browser.close(); }
