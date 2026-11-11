import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDividendLedger, dividendLedgerBase, parseDividendOfficialAnnouncementText } from '../src/lib/dividendLedger.ts';
import { calculateDividendPricing, defaultDividendPricingMethod, dividendPricingAnnuals, dividendPricingTrailingDividend } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import { parseDividendDistributionResearch } from '../src/lib/dividendResearch.ts';
import { parseDividendResponse } from '../src/lib/dividendWorkbench.ts';
import { parseDividendAnnouncements } from '../src/lib/dividendForecast.ts';

const asOf = '2026-11-11';
const annual = {
  code: '300750', announcementDate: '2026-04-15', verifiedAt: asOf,
  sourceUrl: 'https://disc.static.szse.cn/download/disc/disk03/finalpage/2026-04-15/a033b72d-34e0-4757-9056-3e415ac30fb9.PDF',
  text: `证券代码：300750 证券简称：宁德时代
2025年度A股权益分派实施公告
二、本次实施的权益分派方案
公司实施的2025年度A股权益分派方案为：向全体股东每10股派发现金分红人民币69.57元（含税；扣税后，通过深股通持有股份的香港市场投资者每10股派人民币62.613元）。本次不送红股，不转增股本。
三、股权登记日与除权除息日
本次权益分派的股权登记日为：2026年4月21日，除权除息日为：2026年4月22日。`,
};
const interim = {
  code: '300750', announcementDate: '2026-08-04', verifiedAt: asOf,
  sourceUrl: 'https://disc.static.szse.cn/download/disc/disk03/finalpage/2026-08-04/86fab3d4-f48e-43fd-a5ca-faf2ed80ad9d.PDF',
  text: `证券代码：300750 证券简称：宁德时代
2026年中期分红A股实施公告
二、本次实施的中期分红派息方案
公司A股实施的2026年中期分红派息方案为：向全体股东每10股派发现金分红人民币14.11元（含税；扣税后，通过深股通持有股份的香港市场投资者每10股派人民币12.699元）。本次不送红股，不转增股本。
三、股权登记日与除权除息日
本次中期分红派息的股权登记日为2026年8月7日，除权除息日为2026年8月10日。`,
};

test('CATL implementation wording selects gross cash before any investor tax example', () => {
  const parsedAnnual = parseDividendOfficialAnnouncementText(annual.text, annual)!;
  const parsedInterim = parseDividendOfficialAnnouncementText(interim.text, interim)!;
  assert.equal(parsedAnnual.cashPer10Micros, 69_570_000);
  assert.equal(parsedInterim.cashPer10Micros, 14_110_000);
  assert.deepEqual([parsedAnnual.period, parsedAnnual.reportDate], ['annual', '2025-12-31']);
  assert.deepEqual([parsedInterim.period, parsedInterim.reportDate], ['interim', '2026-06-30']);
});

test('unsupported or absent gross cash never falls through to a tax-after amount', () => {
  for (const replacement of ['每10股派发待核现金人民币69.57元', '本次派息金额待核实']) {
    const text = annual.text.replace('每10股派发现金分红人民币69.57元', replacement);
    assert.equal(parseDividendOfficialAnnouncementText(text, annual), undefined);
  }
});

test('CATL screenshot regression uses 8.368 gross DPS and deducts the selected tax exactly once', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json', import.meta.url), 'utf8'));
  const events = [annual, interim].map(source => parseDividendOfficialAnnouncementText(source.text, source)!);
  const ledger = buildDividendLedger(captured.sources.distribution.data, '300750', asOf, { officialEvents: events });
  assert.equal(dividendLedgerBase(ledger, asOf).dpsMicros, 8_368_000);
  for (const [holdingPeriod, expectedDps, expectedFirstBuy] of [
    ['over_year', 8_368_000, 15_214],
    ['month_to_year', 7_531_200, 13_693],
    ['up_to_month', 6_694_400, 12_171],
  ] as const) {
    const pricing = calculateDividendPricing({ code: '300750', name: '宁德时代', financialSector: false, asOf,
      method: { ...defaultDividendPricingMethod(), holdingPeriod }, ledger, annuals: [], priceMinor: 24_713, priceDate: asOf });
    assert.equal(pricing.d1Micros, expectedDps);
    assert.equal(pricing.grid[0].priceMinor, expectedFirstBuy);
    assert.deepEqual(pricing.grid.map(level => level.yieldBps), [550, 575, 600, 650]);
    assert.equal(dividendPricingPlan(pricing)?.buyLevels[0].priceMinor, expectedFirstBuy);
  }
});

test('the same cash parser handles multiple securities and gross labels without using their tax examples', () => {
  for (const code of ['000001', '000333', '600036', '600900']) {
    for (const scheme of [
      '每10股派发现金分红人民币5元（含税；扣税后，每10股派人民币4.5元）',
      '每10股派发现金股利人民币5元（税前）；税后每10股派人民币4.5元',
      '每10股派发现金红利（含税）人民币5元；扣税后每10股派人民币4.5元',
      '每股派发现金分红人民币0.5元（含税）；税后每股派发现金红利人民币0.45元',
      '税后每10股派人民币4.5元；本次税前每10股派发现金红利人民币5元',
    ]) {
      const text = annual.text.replaceAll('300750', code).replace(/每10股派发现金分红人民币69\.57元（[^\n]*?）。/, `${scheme}。`);
      const parsed = parseDividendOfficialAnnouncementText(text, { ...annual, code });
      assert.equal(parsed?.cashPer10Micros, 5_000_000, `${code}: ${scheme}`);
    }
  }
});

test('tax-after-only amounts, including table annotations, never become gross dividends', () => {
  for (const scheme of [
    '每10股派人民币4.5元（税后）',
    '每10股派人民币4.5元（扣税后）',
    '税后每10股派人民币4.5元',
    '税后金额：每10股派人民币4.5元',
    '税后每10股派人民币4.5元；税前金额待查',
    '每10股税前分红 每10股税后分红\n待核实 4.5元',
  ]) {
    const text = annual.text.replace(/每10股派发现金分红人民币69\.57元（[^\n]*?）。/, `${scheme}。`);
    assert.equal(parseDividendOfficialAnnouncementText(text, annual), undefined, scheme);
  }
});

test('all structured-cash consumers use the gross field and cannot fall back to a tax-after profile', () => {
  for (const code of ['000001', '000333', '600036', '600900']) {
    const row = { SECURITY_CODE: code, REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-04-15',
      EX_DIVIDEND_DATE: '2026-04-22', EQUITY_RECORD_DATE: '2026-04-21', ASSIGN_PROGRESS: '实施分配',
      PRETAX_BONUS_RMB: 5, AFTERTAX_BONUS_RMB: 4.5, BONUS_RATIO: 0, IT_RATIO: 0, TOTAL_SHARES: 1000,
      IMPL_PLAN_PROFILE: '10派5元(含税,扣税后4.5元)' };
    const prior = { ...row, REPORT_DATE: '2024-12-31', NOTICE_DATE: '2025-04-15', EX_DIVIDEND_DATE: '2025-04-22', EQUITY_RECORD_DATE: '2025-04-21' };
    const raw = { success: true, result: { pages: 1, data: [row, prior] } };
    const annualRaw = { success: true, result: { data: [{ SECURITY_CODE: code, REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-10', EPSJB: 1 }] } };
    assert.equal(dividendLedgerBase(buildDividendLedger(raw, code, asOf), asOf).dpsMicros, 500_000);
    assert.equal(parseDividendDistributionResearch(raw, code, asOf).dpsMicros, 500_000);
    assert.equal(parseDividendResponse(raw, code, asOf).announcements?.[0].dpsMicros, 500_000);
    assert.equal(parseDividendAnnouncements(raw.result.data, code, asOf)[0].dpsMicros, 500_000);
    assert.equal(dividendPricingAnnuals(annualRaw, undefined, raw, code, asOf)[0].dividendMicros, 500_000);
    assert.equal(dividendPricingTrailingDividend(raw, code, asOf)?.dpsMicros, 500_000);
    const missingGross = { ...raw, result: { ...raw.result, data: [{ ...row, PRETAX_BONUS_RMB: null }, prior] } };
    assert.equal(dividendLedgerBase(buildDividendLedger(missingGross, code, asOf), asOf).dpsMicros, undefined);
    assert.equal(parseDividendAnnouncements(missingGross.result.data, code, asOf)[0].dpsMicros, undefined);
    assert.equal(dividendPricingAnnuals(annualRaw, undefined, missingGross, code, asOf)[0].dividendMicros, undefined);
    assert.equal(dividendPricingTrailingDividend(missingGross, code, asOf)?.cashDistributionsComplete, false);
  }
});
