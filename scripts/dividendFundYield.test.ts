import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFundGridAnchor,
  computeFundTierPrice,
  csindexIndicatorUrl,
  defaultIndexCodeForFund,
  detectFundAnchorUpdate,
  isCsindexIndicatorSupported,
  mergeFundNavHistory,
  parseCsindexDividendYield,
  parseFundBasicIndexInfo,
  parseFundCashPayouts,
  parseFundNavHistory,
  resolveFundYieldSnapshot,
} from '../src/lib/dividendFundYield.ts';

test('defaultIndexCodeForFund and CSIndex support detect known dividend funds and index kinds', () => {
  assert.equal(defaultIndexCodeForFund({ code: '512890', indexKind: 'low_volatility' }).indexCode, 'H30269');
  assert.equal(defaultIndexCodeForFund({ code: '159307', indexKind: 'low_volatility_100' }).indexCode, '930955');
  assert.equal(defaultIndexCodeForFund({ code: '515180', indexKind: 'other' }).indexCode, '000922');
  assert.equal(defaultIndexCodeForFund({ code: '510880', indexKind: 'other' }).indexCode, '000015');
  assert.equal(defaultIndexCodeForFund({ indexKind: 'low_volatility_100' }).indexCode, '930955');
  assert.equal(defaultIndexCodeForFund({ indexKind: 'other' }).indexCode, undefined);

  assert.equal(isCsindexIndicatorSupported('H30269'), true);
  assert.equal(isCsindexIndicatorSupported('930955'), true);
  assert.equal(isCsindexIndicatorSupported('000922'), true);
  assert.equal(isCsindexIndicatorSupported('000015'), true);
  assert.equal(isCsindexIndicatorSupported('399324'), false);
  assert.equal(isCsindexIndicatorSupported('SPCLLHCP'), false);
  assert.equal(
    csindexIndicatorUrl('h30269'),
    'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls',
  );
});

test('parseCsindexDividendYield parses H30269, 930955, and numeric 000922 rows while filtering future/invalid dates', () => {
  const h30269Table = [
    ['日期Date', '指数代码Index Code', '指数中文简称Index Chinese Name', '指数英文简称Index English Name', '股息率1（总股本）D/P1'],
    ['20261119', 'H30269', '红利低波', 'CSI Dividend Low Volatility', 4.99],
    ['20261117', 'H30269', '红利低波', 'CSI Dividend Low Volatility', 4.49],
    ['20261021', 'H30269', '红利低波', 'CSI Dividend Low Volatility', 4.22],
  ];
  const parsed = parseCsindexDividendYield(h30269Table, 'H30269', '2026-11-18');
  assert.equal(parsed.indexCode, 'H30269');
  assert.equal(parsed.yieldBps, 449);
  assert.equal(parsed.asOf, '2026-11-17');
  assert.equal(parsed.indexNameZh, '红利低波');

  const numericCodeTable = [
    ['日期Date', '指数代码Index Code', '股息率1（总股本）D/P1'],
    ['20260230', 922, 9.99],
    ['20261117', 922, 4.49],
  ];
  const parsed000922 = parseCsindexDividendYield(numericCodeTable, '000922', '2026-11-18');
  assert.equal(parsed000922.indexCode, '000922');
  assert.equal(parsed000922.yieldBps, 449);
  assert.equal(parsed000922.asOf, '2026-11-17');

  assert.throws(() => parseCsindexDividendYield([['Foo', 'Bar']], 'H30269', '2026-11-18'));
});

test('parseFundBasicIndexInfo extracts tracking index and latest NAV', () => {
  const basic = parseFundBasicIndexInfo({
    Success: true,
    Datas: {
      FCODE: '159307',
      SHORTNAME: '红利低波100ETF博时',
      INDEXCODE: '930955',
      INDEXNAME: '中证红利低波动100指数',
      DWJZ: '1.0775',
      FSRQ: '2026-11-17',
    },
  }, '159307', '2026-11-18');
  assert.equal(basic.indexCode, '930955');
  assert.equal(basic.indexName, '中证红利低波动100指数');
  assert.equal(basic.navMicros, 1_077_500);
  assert.equal(basic.navDate, '2026-11-17');

  assert.throws(() => parseFundBasicIndexInfo({ Success: false, Datas: null }, '159307', '2026-11-18'));
  assert.throws(() => parseFundBasicIndexInfo({ Success: true, Datas: { FCODE: '512890' } }, '159307', '2026-11-18'));
});

test('parseFundCashPayouts distinguishes paying funds, non-paying funds, null datas, and split-adjusted payouts', () => {
  const asOf = '2026-11-18';
  const paid = parseFundCashPayouts({
    Success: true,
    Datas: {
      FHINFO: [
        { FSRQ: '2026-09-14', FHFCZ: '0.011', FHFCBZ: '0', FH: '每份派现金0.011元' },
        { FSRQ: '2026-06-12', FHFCZ: '0.0126', FHFCBZ: '0', FH: '每份派现金0.0126元' },
        { FSRQ: '2026-03-13', FHFCZ: '0.0131', FHFCBZ: '0', FH: '每份派现金0.0131元' },
        { FSRQ: '2025-12-15', FHFCZ: '0.0119', FHFCBZ: '0', FH: '每份派现金0.0119元' },
        { FSRQ: '2025-09-16', FHFCZ: '0.013', FHFCBZ: '0', FH: '每份派现金0.013元' },
      ],
      FCINFO: [],
    },
  }, asOf);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.trailingCount, 4);
  assert.equal(paid.totalCount, 5);
  assert.equal(paid.trailing12mMicros, 48600);
  assert.equal(paid.latestExDate, '2026-09-14');

  const noDivWithSplit = parseFundCashPayouts({
    Success: true,
    Datas: {
      FHINFO: [],
      FCINFO: [{ FSRQ: '2021-10-22', FHFCZ: '2', FHFCBZ: '105', CFLX: '份额分拆' }],
    },
  }, asOf);
  assert.equal(noDivWithSplit.status, 'none');
  assert.equal(noDivWithSplit.trailing12mMicros, 0);
  assert.equal(noDivWithSplit.totalCount, 0);

  const nullDatas = parseFundCashPayouts({ Success: true, Datas: null }, asOf);
  assert.equal(nullDatas.status, 'none');
  assert.equal(nullDatas.totalCount, 0);

  const splitAdjusted = parseFundCashPayouts({
    Success: true,
    Datas: {
      FHINFO: [{ FSRQ: '2026-01-10', FHFCZ: '0.10', FHFCBZ: '0' }],
      FCINFO: [{ FSRQ: '2026-06-01', FHFCZ: '2', FHFCBZ: '105' }],
    },
  }, asOf);
  assert.equal(splitAdjusted.trailing12mMicros, 50000);

  assert.throws(() => parseFundCashPayouts({ Success: false, Datas: null }, asOf));
});

test('resolveFundYieldSnapshot prioritizes scraped CSIndex yield over stale manual reference and never uses shared defaults', () => {
  const fund512890 = {
    code: '512890',
    indexKind: 'low_volatility' as const,
    quote: { priceMicros: 1_263_000, date: '2026-11-17 15:00', fetchedAt: 1000 },
    reference: { indexYieldBps: 430, asOf: '2026-10-21', source: 'manual' },
  };
  const cache512890 = {
    key: 'fund:512890',
    fundCode: '512890',
    indexCode: 'H30269',
    indexName: '中证红利低波动指数',
    indexYield: {
      indexCode: 'H30269',
      indexNameZh: '中证红利低波',
      yieldBps: 449,
      asOf: '2026-11-17',
      sourceUrl: csindexIndicatorUrl('H30269'),
    },
    payout: { status: 'none' as const, trailing12mMicros: 0, trailingCount: 0, totalCount: 0, asOf: '2026-11-18' },
    fetchedAt: 1000,
  };
  const snap512890 = resolveFundYieldSnapshot(fund512890, cache512890);
  assert.equal(snap512890.indexCode, 'H30269');
  assert.equal(snap512890.indexYield?.yieldBps, 449);
  assert.equal(snap512890.indexYield?.sourceKind, 'csindex');
  assert.equal(snap512890.payout?.status, 'none');
  assert.equal(snap512890.payoutYieldBps, undefined);

  const fund159307 = {
    code: '159307',
    indexKind: 'low_volatility_100' as const,
    quote: { priceMicros: 1_073_000, date: '2026-11-17 15:00', fetchedAt: 1000 },
  };
  const cache159307 = {
    key: 'fund:159307',
    fundCode: '159307',
    indexCode: '930955',
    indexName: '中证红利低波动100指数',
    indexYield: {
      indexCode: '930955',
      indexNameZh: '红利低波100',
      yieldBps: 447,
      asOf: '2026-11-17',
      sourceUrl: csindexIndicatorUrl('930955'),
    },
    payout: {
      status: 'paid' as const,
      trailing12mMicros: 48600,
      trailingCount: 4,
      totalCount: 9,
      latestExDate: '2026-09-14',
      latestPayoutMicros: 11000,
      asOf: '2026-11-18',
    },
    fetchedAt: 1000,
  };
  const snap159307 = resolveFundYieldSnapshot(fund159307, cache159307);
  assert.equal(snap159307.indexCode, '930955');
  assert.equal(snap159307.indexYield?.yieldBps, 447);
  assert.equal(snap159307.payout?.status, 'paid');
  assert.equal(snap159307.payoutYieldBps, 453);

  // Without cache and without manual reference on an unsupported index, yield stays undefined (never shared)
  const uncachedOther = resolveFundYieldSnapshot({ code: '159905', indexKind: 'other' });
  assert.equal(uncachedOther.indexYield, undefined);
});

test('parseFundNavHistory and mergeFundNavHistory parse, filter future dates, dedupe and sort newest first', () => {
  const parsed = parseFundNavHistory(
    {
      Success: true,
      Datas: [
        { FSRQ: '2026-11-19', DWJZ: '1.2900' },
        { FSRQ: '2026-11-18', DWJZ: '1.2750' },
        { FSRQ: '2026-11-17', DWJZ: '1.2664' },
        { FSRQ: '2026-11-17', DWJZ: '1.9999' },
        { FSRQ: 'bad-date', DWJZ: '1.2500' },
        { FSRQ: '2026-11-14', DWJZ: '-1' },
      ],
    },
    '2026-11-18',
  );
  assert.deepEqual(parsed, [
    { date: '2026-11-18', navMicros: 1_275_000 },
    { date: '2026-11-17', navMicros: 1_266_400 },
  ]);

  const merged = mergeFundNavHistory(
    parsed,
    [
      { date: '2026-11-17', navMicros: 1_200_000 },
      { date: '2026-11-14', navMicros: 1_255_000 },
      { date: '2026-11-13', navMicros: 1_240_000 },
    ],
    3,
  );
  assert.deepEqual(merged, [
    { date: '2026-11-18', navMicros: 1_275_000 },
    { date: '2026-11-17', navMicros: 1_266_400 },
    { date: '2026-11-14', navMicros: 1_255_000 },
  ]);
});

test('Option A1 keeps tier reference prices fixed across intraday live price moves when anchored to same-day NAV', () => {
  const fundCache = {
    key: 'fund:512890',
    fundCode: '512890',
    indexCode: 'H30269',
    indexName: '中证红利低波动指数',
    navMicros: 1_266_400,
    navDate: '2026-11-17',
    navHistory: [
      { date: '2026-11-18', navMicros: 1_280_000 },
      { date: '2026-11-17', navMicros: 1_266_400 },
    ],
    indexYield: {
      indexCode: 'H30269',
      indexNameZh: '红利低波',
      yieldBps: 449,
      asOf: '2026-11-17',
      sourceUrl: csindexIndicatorUrl('H30269'),
    },
    fetchedAt: 1000,
  };

  const snapNormal = resolveFundYieldSnapshot(
    { code: '512890', indexKind: 'low_volatility', quote: { priceMicros: 1_266_000, date: '2026-11-18 10:30', fetchedAt: 2000 } },
    fundCache,
  );
  const snapDip = resolveFundYieldSnapshot(
    { code: '512890', indexKind: 'low_volatility', quote: { priceMicros: 1_150_000, date: '2026-11-18 13:15', fetchedAt: 3000 } },
    fundCache,
  );
  const snapRally = resolveFundYieldSnapshot(
    { code: '512890', indexKind: 'low_volatility', quote: { priceMicros: 1_380_000, date: '2026-11-18 14:45', fetchedAt: 4000 } },
    fundCache,
  );

  assert.equal(snapNormal.anchorDateMatched, true);
  assert.equal(snapNormal.anchorDate, '2026-11-17');
  assert.equal(snapNormal.anchorPriceMicros, 1_266_400);
  assert.equal(snapNormal.impliedAnnualDpsMicros, 56_861);

  for (const snap of [snapNormal, snapDip, snapRally]) {
    assert.equal(snap.impliedAnnualDpsMicros, 56_861);
    assert.equal(Number(computeFundTierPrice(snap, 5.0)?.toFixed(4)), 1.1372);
    assert.equal(Number(computeFundTierPrice(snap, 4.5)?.toFixed(4)), 1.2636);
    assert.equal(Number(computeFundTierPrice(snap, 4.0)?.toFixed(4)), 1.4215);
  }

  assert.equal(snapNormal.liveEstimatedYieldBps, 449);
  assert.equal(snapDip.liveEstimatedYieldBps, 494);
  assert.equal(snapRally.liveEstimatedYieldBps, 412);

  // Unaligned NAV date falls back gracefully and reports anchorDateMatched = false
  const unaligned = resolveFundYieldSnapshot(
    { code: '512890', indexKind: 'low_volatility', quote: { priceMicros: 1_260_000, date: '2026-11-18 10:30', fetchedAt: 2000 } },
    { ...fundCache, navDate: '2026-11-18', navMicros: 1_280_000, navHistory: [{ date: '2026-11-18', navMicros: 1_280_000 }] },
  );
  assert.equal(unaligned.anchorDateMatched, false);
  assert.equal(unaligned.anchorPriceMicros, 1_280_000);
});

test('computeFundGridAnchor and detectFundAnchorUpdate emit notice only on official anchor changes', () => {
  const anchor1 = computeFundGridAnchor('2026-11-17', 449, 1_266_400);
  assert.equal(anchor1.impliedAnnualDpsMicros, 56_861);

  // Initial creation should not produce an update banner
  const initialNotice = detectFundAnchorUpdate(undefined, anchor1, undefined, '512890', 1000);
  assert.equal(initialNotice, undefined);

  // Unchanged anchor keeps existing dismissed notice intact
  const dismissedNotice = {
    fundCode: '512890',
    previousAsOf: '2026-11-14',
    previousYieldBps: 452,
    previousAnchorPriceMicros: 1_255_000,
    previousDpsMicros: 56_726,
    currentAsOf: '2026-11-17',
    currentYieldBps: 449,
    currentAnchorPriceMicros: 1_266_400,
    currentDpsMicros: 56_861,
    updatedAt: 1500,
    dismissed: true,
  };
  const sameRefresh = detectFundAnchorUpdate(anchor1, computeFundGridAnchor('2026-11-17', 449, 1_266_400), dismissedNotice, '512890', 2000);
  assert.deepEqual(sameRefresh, dismissedNotice);

  // Next day CSIndex + same-day NAV update produces a fresh undismissed notice
  const anchor2 = computeFundGridAnchor('2026-11-18', 442, 1_280_000);
  const nextNotice = detectFundAnchorUpdate(anchor1, anchor2, dismissedNotice, '512890', 3000);
  assert.deepEqual(nextNotice, {
    fundCode: '512890',
    previousAsOf: '2026-11-17',
    previousYieldBps: 449,
    previousAnchorPriceMicros: 1_266_400,
    previousDpsMicros: 56_861,
    currentAsOf: '2026-11-18',
    currentYieldBps: 442,
    currentAnchorPriceMicros: 1_280_000,
    currentDpsMicros: 56_576,
    updatedAt: 3000,
    dismissed: false,
  });
});
