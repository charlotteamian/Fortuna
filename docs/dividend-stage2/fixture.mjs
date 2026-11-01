import { readFile } from 'node:fs/promises';

export const origin = process.env.FORTUNA_STAGE2_ORIGIN ?? 'http://127.0.0.1:5187';
export const stockCodes = ['000001', '000002', '000003', '000004', '000005', '600036', '600001', '600002', '600003', '600004'];
export async function isolate(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/qt-api/')) {
      const rows = [...stockCodes, '512890'].map(code => {
        const fields = Array(40).fill('');
        fields[1] = 'Synthetic'; fields[2] = code; fields[3] = code === '512890' ? '1.2' : '8';
        fields[30] = `${code === '000005' ? '20261031' : '20261101'}100000`; fields[32] = '0';
        return `v_${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
      }).join('\n');
      return route.fulfill({ body: rows });
    }
    if (url.pathname.startsWith('/src/services/dividendResearchService.ts')) return route.fulfill({ contentType: 'text/javascript', body: `import { loadDividendResearchCache } from '/src/services/dividendResearchCacheService.ts'; export async function fetchDividendResearch(stocks) { const cache=await loadDividendResearchCache();return {...cache.snapshot,stocks:cache.snapshot.stocks.filter(s=>stocks.some(x=>x.code===s.code))}; }` });
    if (/api\//.test(url.pathname)) return route.abort();
    return route.continue();
  });
  await page.clock.setFixedTime(new Date('2026-11-01T03:00:00Z'));
}

export async function seed(page, { preferences = false } = {}) {
  const fixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
  const official = await Promise.all(['pingan-2025-final', 'pingan-2026-interim'].map(name => readFile(new URL(`../../scripts/fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
  await page.goto(origin);
  return page.evaluate(async ({ fixture, official, stockCodes, preferences }) => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { defaultDividendPricingMethod, calculateDividendPricing, dividendPricingAnnuals } = await import('/src/lib/dividendPricing.ts');
    const { defaultDividendSelectionPrinciples, parseDividendFinancialResearch } = await import('/src/lib/dividendResearch.ts');
    const { buildDividendLedger, parseDividendOfficialAnnouncementText } = await import('/src/lib/dividendLedger.ts');
    const { dividendPricingPlan, dividendPricingProvenance } = await import('/src/lib/dividendPricingPlan.ts');
    const { saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    await initializeSettings(); const now = Date.now(), asOf = '2026-11-01', method = defaultDividendPricingMethod();
    const principles = { ...defaultDividendSelectionPrinciples(), minRoeBps: 1000 };
    await updateSettings({ language: 'zh', amountVisible: false, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      dividendWorkbenchInitialized: true, dividendBudgetMinor: 3000000, dividendPricingMethod: method, dividendSelectionPrinciples: principles, themeMode: 'dark',
      ...(preferences ? { dividendHomeCollapsedCodes: stockCodes } : {}),
      dividendFundPlan: { budgetMinor: 1000000, mode: 'swing', entryRule: 'both', drawdownBps: 1000, indexYieldBps: 500, funds: [
        { id: 'fund-live', name: '模拟行情基金', code: '512890', indexKind: 'low_volatility_100', weightBps: 6000, reference: { asOf, highMicros: 1200000, indexYieldBps: 450, source: 'Synthetic reference' } },
        { id: 'fund-unknown', name: '模拟未知持仓基金', indexKind: 'other', weightBps: 4000, reference: { asOf, priceMicros: 1200000, highMicros: 1200000, indexYieldBps: 550, source: 'Synthetic manual reference' } },
      ] } });
    await db.accounts.put({ id: 'stage2-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 12345, sortOrder: 0, createdAt: 1 });
    await db.holdings.put({ id: 'stage2-holding', accountId: 'stage2-account', name: '模拟行情基金', symbol: '512890', lastPrice: 1.2, sortOrder: 0, createdAt: 1 });
    await db.holdingTxns.put({ id: 'stage2-buy', accountId: 'stage2-account', holdingId: 'stage2-holding', date: '2026-09-01', kind: 'buy', shares: 500, price: 1, createdAt: 1 });
    const officialEvents = official.map(({ text, ...metadata }) => parseDividendOfficialAnnouncementText(text, metadata));
    const originalLedger = buildDividendLedger(fixture.sources.distribution.data, '000001', asOf, { officialEvents });
    const annuals = dividendPricingAnnuals(fixture.sources.financial.data, undefined, fixture.sources.distribution.data, '000001', asOf);
    const store = new Dexie('FortunaDividendLedger'); store.version(1).stores({ documents: 'url', ledgers: 'code' });
    const stocks = [], research = [];
    for (const code of stockCodes) {
      const ledger = structuredClone(originalLedger); ledger.code = code;
      ledger.events.forEach(event => { event.code = code; event.id = event.id.replace('000001', code); event.batchId = event.batchId.replace('000001', code); });
      const pricing = calculateDividendPricing({ code, name: `模拟${code}`, asOf, ledger, annuals, method, financialSector: true });
      const savedPricing = code === '000004' ? calculateDividendPricing({ code, name: `模拟${code}`, asOf, ledger, annuals, method: { ...method, holdingPeriod: 'over_year' }, financialSector: true }) : pricing;
      const saved = dividendPricingPlan(savedPricing);
      stocks.push({ code, name: `模拟${code}`, group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: code === '000001' ? 200 : code === '600036' ? 10000 : code === '600001' ? 250 : 0, lotSize: 100,
        buyPaused: code === '000001', manualDpsMicros: 609000,
        ...(code === '000002' ? {} : { ...saved, gridProvenance: dividendPricingProvenance(savedPricing, now - 1000) }),
        ...(code === '600003' ? { buyLevels: saved.buyLevels.map((level, index) => index === 1 ? level : { ...level, priceMinor: undefined }) } : {}),
        dividend: { schemaVersion: 2, dpsMicros: 0, asOf, windowStart: asOf, payments: [], announcements: [], fetchedAt: now } });
      if (code !== '000002') await store.table('ledgers').put(code === '000003' ? { code, asOf, events: null, issues: [], complete: true } : ledger);
      research.push({ code, name: `模拟${code}`, pricing, yieldBps: 544, financial: parseDividendFinancialResearch(fixture.sources.financial.data, '000001', asOf), checks: [], status: 'unknown', sources: [], issues: [] });
    }
    await db.dividendStocks.bulkPut(stocks); store.close();
    await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now, principles, pricingMethod: method, stocks: research, indices: [] }, ...(preferences ? { collapsedCodes: stockCodes } : {}) });
    if (!preferences) {
      const cache = new Dexie('FortunaDividendResearchCache'); cache.version(1).stores({ results: 'id' });
      const record = await cache.table('results').get('latest'); delete record.collapsedCodes;
      await cache.table('results').put(record); cache.close();
    }
    return { asOf, stocks, fundPlan: (await db.settings.get('main')).dividendFundPlan };
  }, { fixture, official, stockCodes, preferences });
}

export async function home(page) {
  await page.goto(origin);
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-stock-reading').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.div-quote-status button')?.disabled);
}

export async function measure(page) {
  return page.evaluate(() => {
    const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const viewport = document.querySelector('.app-content').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.div-stock-reading, .div-fund-home-card')];
    const rows = cards.map(element => ({ name: element.querySelector('.div-stock-title, h3')?.textContent, height: element.getBoundingClientRect().height,
      intersectsViewport: element.getBoundingClientRect().bottom > viewport.top && element.getBoundingClientRect().top < viewport.bottom,
      fullyInViewport: element.getBoundingClientRect().top >= viewport.top && element.getBoundingClientRect().bottom <= viewport.bottom,
      tables: [...element.querySelectorAll('table')].filter(visible).length }));
    const lists = [...document.querySelectorAll('.div-stock-home > .div-stock-list, .df-home-list')];
    return { rows, cardHeight: rows.reduce((sum, row) => sum + row.height, 0), listHeight: lists.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0),
      renderedItems: rows.length, itemsInViewport: rows.filter(row => row.intersectsViewport).length, completeItemsInViewport: rows.filter(row => row.fullyInViewport).length,
      visibleTables: rows.reduce((sum, row) => sum + row.tables, 0),
      overflow: [...document.querySelectorAll('.dividend-page *')].filter(element => visible(element) && element.getBoundingClientRect().right > innerWidth + 1).map(element => element.className),
      font: getComputedStyle(document.documentElement).fontSize };
  });
}

/** Preserve the actual rendered width while allowing screenshots of nested scroll content in full. */
export async function captureTarget(page, target, path) {
  await page.evaluate(() => {
    window.__stage2ScreenshotScroll = [...document.querySelectorAll('.app-content, .div-advisor-reader-scroll')].map(element => [element, element.scrollTop]);
    document.documentElement.classList.add('stage2-capture');
  });
  const style = await page.addStyleTag({ content: `
    html.stage2-capture, .stage2-capture body, .stage2-capture #root, .stage2-capture .app { height:auto; overflow:visible; }
    .stage2-capture .app-content { flex:none; height:auto; max-height:none; overflow:visible; }
    .stage2-capture .tab-bar, .stage2-capture body:has(.div-advisor-reader) #root { display:none; }
    .stage2-capture .div-advisor-reader { position:relative; inset:auto; height:auto; overflow:visible; }
    .stage2-capture .div-advisor-reader-scroll { flex:none; height:auto; max-height:none; overflow:visible; }
  ` });
  try { await target.screenshot({ path }); }
  finally {
    await style.evaluate(element => element.remove());
    await page.evaluate(() => {
      document.documentElement.classList.remove('stage2-capture');
      for (const [element, top] of window.__stage2ScreenshotScroll) element.scrollTop = top;
      delete window.__stage2ScreenshotScroll;
    });
  }
}
