import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClassicDailyAdviceMarkdown,
  buildClassicStockPlan,
  resolveClassicDividendBase,
} from '../src/lib/dividendClassicStrategy.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

function makeStock(overrides: Partial<DividendStock> = {}): DividendStock {
  return {
    code: '601088',
    name: '中国神华',
    group: 'core',
    weightBps: 1000,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 0,
    ...overrides,
  };
}

test('resolveClassicDividendBase: Tier 1 manual DPS takes highest priority', () => {
  const stock = makeStock({
    manualDpsMicros: 2_500_000,
  });
  const base = resolveClassicDividendBase(stock, { taxBps: 1000 });
  assert.equal(base.tier, 'manual');
  assert.equal(base.grossDpsMicros, 2_500_000);
  assert.equal(base.netDpsMicros, 2_250_000);
  assert.equal(base.fallbackApplied, false);
});

test('resolveClassicDividendBase: Tier 2 combines implemented H1 + FY regular cycle without blocking on missing PDFs', () => {
  const stock = makeStock({
    code: '601398',
    name: '工商银行',
    dividend: {
      dpsMicros: 164_600,
      date: '2025-07-15',
      payments: [],
      announcements: [
        {
          reportDate: '2024-12-31',
          period: 'FY',
          dpsMicros: 164_600,
          announcedAt: '2025-03-28',
          stage: 'implemented',
          status: '实施',
          sourceUrl: 'https://data.eastmoney.com',
          exDate: '2025-07-15',
          nonRecurring: false,
        },
        {
          reportDate: '2024-06-30',
          period: 'H1',
          dpsMicros: 143_400,
          announcedAt: '2024-08-30',
          stage: 'implemented',
          status: '实施',
          sourceUrl: 'https://data.eastmoney.com',
          exDate: '2025-01-07',
          nonRecurring: false,
        },
        {
          reportDate: '2024-09-30',
          period: 'other',
          dpsMicros: 500_000,
          announcedAt: '2024-11-01',
          stage: 'implemented',
          status: '特别分红',
          sourceUrl: 'https://data.eastmoney.com',
          exDate: '2025-02-01',
          nonRecurring: true,
        },
      ],
    },
  });

  const base = resolveClassicDividendBase(stock, { asOf: '2025-08-01', taxBps: 1000 });
  assert.equal(base.tier, 'implemented_cycle');
  // 0.1646 + 0.1434 = 0.3080 yuan (308,000 micros), special dividend excluded
  assert.equal(base.grossDpsMicros, 308_000);
  assert.equal(base.frequency, 'semiannual');
  assert.equal(base.batches.length, 2);
});

test('resolveClassicDividendBase: Tier 3 falls back to announced proposal when no implemented history exists', () => {
  const stock = makeStock({
    code: '688999',
    name: '测试红利股',
    dividend: {
      dpsMicros: 0,
      date: '2025-04-01',
      payments: [],
      announcements: [
        {
          reportDate: '2024-12-31',
          period: 'FY',
          dpsMicros: 880_000,
          announcedAt: '2025-03-30',
          stage: 'proposal',
          status: '董事会预案',
          sourceUrl: 'https://data.eastmoney.com',
        },
      ],
    },
  });

  const base = resolveClassicDividendBase(stock, { asOf: '2025-05-01', taxBps: 1000 });
  assert.equal(base.tier, 'announced_forecast');
  assert.equal(base.grossDpsMicros, 880_000);
  assert.equal(base.fallbackApplied, true);
});

test('resolveClassicDividendBase: Tier 4 falls back to classic stock baseline when dividend data is completely absent', () => {
  const stock = makeStock({
    code: '600900',
    name: '长江电力',
    quote: { priceMinor: 2780, date: '2025-07-01' },
  });

  const base = resolveClassicDividendBase(stock, { asOf: '2025-07-01', taxBps: 1000 });
  assert.equal(base.tier, 'baseline_fallback');
  assert.equal(base.grossDpsMicros, 943_000);
  assert.equal(base.fallbackApplied, true);
});

test('buildClassicStockPlan: calculates 4-buy and 4-sell grid prices, triggers, and lot sizes accurately', () => {
  const stock = makeStock({
    code: '601088',
    name: '中国神华',
    weightBps: 10000, // 100% of totalBudgetMinor
    manualDpsMicros: 2_260_000, // ¥2.26 gross DPS
    manualShares: 200,
    quote: { priceMinor: 3500, date: '2025-07-01' }, // Current price ¥35.00
  });

  // Tax 10% (1000 bps) -> net DPS = 2.26 * 0.9 = ¥2.034 (2,034,000 micros)
  // Buy 1 (5.50% = 550 bps): floor(2034000 / 550) = 3698 minor (¥36.98)
  // Buy 2 (5.75% = 575 bps): floor(2034000 / 575) = 3537 minor (¥35.37)
  // Buy 3 (6.00% = 600 bps): floor(2034000 / 600) = 3390 minor (¥33.90)
  // Buy 4 (6.50% = 650 bps): floor(2034000 / 650) = 3129 minor (¥31.29)
  const plan = buildClassicStockPlan(stock, {
    totalBudgetMinor: 4_000_000, // ¥40,000 budget
    shares: 200,
    taxBps: 1000,
    asOf: '2025-07-01',
  });

  assert.equal(plan.base.netDpsMicros, 2_034_000);
  assert.deepEqual(
    plan.buyRows.map(t => t.priceMinor),
    [3698, 3537, 3390, 3129],
  );
  // At ¥35.00 (3500 minor), Buy 1 (<=36.98) and Buy 2 (<=35.37) are triggered!
  assert.equal(plan.todayAction.type, 'buy');
  assert.equal(plan.todayAction.triggeredBuyLevel, 2);
  assert.equal(plan.buyRows[0].touched, true);
  assert.equal(plan.buyRows[1].touched, true);
  assert.equal(plan.buyRows[2].touched, false);
  assert.ok(plan.todayAction.suggestedShares > 0);
  assert.equal(plan.healthChecks.length, 3);
});

test('buildClassicDailyAdviceMarkdown: generates clear daily trading instructions', () => {
  const stockA = makeStock({
    code: '601088',
    name: '中国神华',
    weightBps: 5000,
    manualDpsMicros: 2_260_000,
    quote: { priceMinor: 3500, date: '2025-07-01' },
  });
  const stockB = makeStock({
    code: '600900',
    name: '长江电力',
    weightBps: 5000,
    manualDpsMicros: 1_150_000,
    manualShares: 500,
    quote: { priceMinor: 2800, date: '2025-07-01' },
  });

  const plans = [
    buildClassicStockPlan(stockA, { totalBudgetMinor: 8_000_000, shares: 0, taxBps: 1000, asOf: '2025-07-01' }),
    buildClassicStockPlan(stockB, { totalBudgetMinor: 8_000_000, shares: 500, taxBps: 1000, asOf: '2025-07-01' }),
  ];

  const markdownAll = buildClassicDailyAdviceMarkdown(plans, { asOf: '2025-07-01' });
  assert.match(markdownAll, /今日红利网格操作建议/);
  assert.match(markdownAll, /中国神华/);
  assert.match(markdownAll, /长江电力/);

  const markdownSingle = buildClassicDailyAdviceMarkdown(plans, { selectedCode: '601088', asOf: '2025-07-01' });
  assert.match(markdownSingle, /中国神华（601088）/);
  assert.match(markdownSingle, /买入四档/);
  assert.match(markdownSingle, /卖出四档/);
});
