import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { dividendAnnualReportEvidence } from '../src/lib/dividendAnnualReportEvidence.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import { DIVIDEND_PRICING_CALCULATION_VERSION, calculateDividendPricing, defaultDividendPricingMethod, dividendPricingAnnuals, dividendPricingPriceHistory, dividendPricingYieldHistory, dividendPricingTrailingDividend, dividendPricingHistoryCoverage, dividendPricingMarketComparison, invalidateOutdatedDividendPricing,
  parseDividendTreasury, parseDividendOpportunityRows, dividendPricingReadable, type DividendYieldHistory, type DividendPricingAnnual } from '../src/lib/dividendPricing.ts';

const asOf = '2026-10-21';
function trailingDividend(dpsMicros=500000, date=asOf) { return { dpsMicros, asOf:date, windowStart:`${Number(date.slice(0,4))-1}${date.slice(4)}`, capitalActionsVerified:true, cashDistributionsComplete:true, sourceUrls:['https://example.com/implemented-dividends'] }; }
const annuals: DividendPricingAnnual[] = Array.from({length:5},(_,i) => ({year:2025-i,reportDate:`${2025-i}-12-31`,noticeDate:`${2026-i}-03-20`,
  epsMicros:1000000,adjustedEpsMicros:1000000,roeBps:1000,dividendMicros:500000,payoutBps:5000,fcfCoverageBps:20000}));
const history: DividendYieldHistory = {basis:'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close',capitalActionsVerified:true,from:'2016-10-28',through:'2026-09-28',sourceUrls:[],
  samples:Array.from({length:120},(_,i) => ({date:`${2016+Math.floor((i+9)/12)}-${String((i+9)%12+1).padStart(2,'0')}-28`,yieldBps:500,treasuryBps:200,spreadBps:300}))};
function input() { return {code:'600000',name:'Fixture',financialSector:false,method:defaultDividendPricingMethod(),annuals:structuredClone(annuals),asOf,trailingDividend:trailingDividend(),
  history:structuredClone(history),treasury:{yieldBps:200,asOf,fetchedAt:1,history:[],sourceUrl:'https://example.com/treasury'},
  opportunity:{yieldBps:500,asOf,sourceUrl:'https://example.com/comparison',basis:'Dated comparator'},priceMinor:1000,priceDate:asOf,bvpsMicros:20000000}; }

test('old or incompatible calculation versions retain evidence but cannot recreate a fresh price plan', () => {
  const current = calculateDividendPricing(input());
  assert.equal(current.calculationVersion, DIVIDEND_PRICING_CALCULATION_VERSION);
  assert.ok(dividendPricingPlan(current));
  for (const calculationVersion of [undefined, DIVIDEND_PRICING_CALCULATION_VERSION - 1, DIVIDEND_PRICING_CALCULATION_VERSION + 1]) {
    const historic = { ...current, calculationVersion }, before = structuredClone(historic);
    const guarded = invalidateOutdatedDividendPricing(historic);
    assert.equal(guarded.canApply, false);
    assert.ok(guarded.blockers.includes('pricing_calculation_stale'));
    assert.deepEqual(guarded.annuals, current.annuals);
    assert.deepEqual(guarded.grid, current.grid);
    assert.equal(dividendPricingPlan(historic), null, 'raw supplied context cannot bypass the version check');
    assert.equal(dividendPricingReadable(historic)['Valuation draft ready for preview and confirmation'], false);
    assert.equal(dividendPricingMarketComparison(historic).quoteUsable, false);
    assert.deepEqual(historic, before, 'dated historical results must not be mutated');
  }
});

test('captured Ping An Bank exact implemented cash produces the fixed-yield ladder without inventing reached buy levels', () => {
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json',import.meta.url),'utf8'));
  const prices=dividendPricingPriceHistory(f.sources.month.data,'sz000001',f.asOf), quote=prices.at(-1)!;
  const treasury=parseDividendTreasury(f.sources.treasury.data,f.asOf);
  const opportunity=parseDividendOpportunityRows(f.sources.opportunity.data,f.asOf);
  const years=dividendPricingAnnuals(f.sources.financial.data,undefined,f.sources.distribution.data,'000001',f.asOf);
  const p=calculateDividendPricing({code:'000001',name:'平安银行',financialSector:true,asOf:f.asOf,
    method:defaultDividendPricingMethod(),annuals:years,treasury,opportunity,
    trailingDividend:dividendPricingTrailingDividend(f.sources.distribution.data,'000001',f.asOf),
    history:dividendPricingYieldHistory(prices.filter(price=>price.date.slice(0,7)<'2026-10'),f.sources.distribution.data,'000001',treasury),
    priceMinor:quote.priceMinor,priceDate:quote.date});
  assert.deepEqual(years.map(year=>[year.year,year.payoutBps]),[[2025,2713],[2024,2651],[2023,3004],[2022,1215],[2021,1218]]);
  assert.equal(p.normalizedEpsMicros,2160000);assert.equal(p.sustainablePayoutBps,2651);
  assert.equal(p.earningsDividendMicros,572616);assert.equal(p.d1Micros,609000);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.theoreticalPriceMinor,1218);
  assert.deepEqual(p.grid.map(level=>level.priceMinor),[1107,1059,1015,936]);
  assert.deepEqual(dividendPricingMarketComparison(p),{quoteUsable:true,estimateGapBps:875,reachedBuyLevels:[],sustainableYieldAtQuoteBps:544,largeDiscount:false});
  const plan=dividendPricingPlan(p)!;assert.equal(plan.buyLevels.length,4);
  assert.deepEqual(plan.sellLevels.map(level=>level.priceMinor),[1268,1353,1450,1522]);
});

test('CATL cash omissions remain an explicit TTM blocker instead of substituting an EPS-based dividend', () => {
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json',import.meta.url),'utf8'));
  const market=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-market-2026-10-23.json',import.meta.url),'utf8'));
  const macro=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json',import.meta.url),'utf8'));
  const asOf='2026-10-23', prices=dividendPricingPriceHistory(market.data,'sz300750',asOf), quote=prices.at(-1)!;
  const treasury=parseDividendTreasury(macro.sources.treasury.data,asOf), opportunity=parseDividendOpportunityRows(macro.sources.opportunity.data,asOf);
  const history=dividendPricingYieldHistory(prices.filter(price=>price.date.slice(0,7)<'2026-10'),f.sources.distribution.data,'300750',treasury);
  assert.equal(history?.cashDistributionsComplete,false);
  assert.ok(dividendPricingHistoryCoverage(history,asOf).reasons.includes('cash_distributions_incomplete'));
  const trailingDividend=dividendPricingTrailingDividend(f.sources.distribution.data,'300750',asOf);
  assert.equal(trailingDividend?.cashDistributionsComplete,false);
  const p=calculateDividendPricing({code:'300750',name:'宁德时代',financialSector:false,asOf,method:defaultDividendPricingMethod(),
    trailingDividend,annuals:dividendPricingAnnuals(f.sources.financial.data,f.sources.cash.data,f.sources.distribution.data,'300750',asOf),
    treasury,opportunity,history,priceMinor:quote.priceMinor,priceDate:quote.date});
  assert.equal(p.anchors.historicalPercentileBps,undefined);
  assert.equal(p.earningsDividendMicros,5898867);assert.equal(p.canApply,false);
  assert.ok(p.blockers.includes('cash_distributions_incomplete'));
  assert.equal(p.d1Micros,undefined);assert.equal(p.theoreticalPriceMinor,undefined);assert.deepEqual(p.grid,[]);
  assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels,[]);assert.equal(dividendPricingPlan(p),null);
});

test('independent arithmetic uses exact TTM and four fixed yields while earnings, Gordon and PB remain comparisons', () => {
  const p=calculateDividendPricing(input());
  assert.equal(p.canApply,true);assert.equal(p.d1Micros,500000);assert.equal(p.anchors.medianBps,500);
  assert.equal(p.gordonPriceMinor,625);assert.equal(p.anchorPriceMinor,1000);assert.equal(p.pbBridgePriceMinor,2000);
  assert.equal(p.theoreticalPriceMinor,1000);assert.equal(p.marginPriceMinor,850);
  assert.deepEqual(p.grid.map(g=>g.priceMinor),[909,869,833,769]);
  assert.deepEqual(p.grid.map(g=>g.yieldBps),[550,575,600,650]);
  assert.deepEqual(p.grid.map(g=>g.cumulativePortionBps),[2500,5000,7500,10000]);
  assert.deepEqual(p.grid.map(g=>g.meetsSafetyMargin),[false,false,true,true]);
  assert.doesNotMatch(JSON.stringify(dividendPricingReadable(p)),/priceMinor|d1Micros|fcfCoverageBps/);
});

test('growth changes the Gordon denominator once and tax changes the cash numerator once', () => {
  const v=input();v.method.growthBps=100;v.method.holdingPeriod='month_to_year';const p=calculateDividendPricing(v);
  assert.equal(p.d1Micros,450000);assert.equal(p.gordonYieldBps,700);assert.equal(p.gordonPriceMinor,642);
});
test('lower Gordon and PB comparisons do not cap the fixed-yield ladder', () => {
  const v=input();v.annuals.forEach(year=>{year.roeBps=100;});
  const p=calculateDividendPricing(v);
  assert.equal(p.gordonPriceMinor,625);assert.equal(p.pbBridgePriceMinor,200);
  assert.equal(p.anchorPriceMinor,1000);assert.equal(p.theoreticalPriceMinor,1000);
  assert.deepEqual(p.grid.map(level=>level.priceMinor),[909,869,833,769]);
});

test('reported 100.21% payout and 126.64% coverage remain visible without replacing implemented TTM cash', () => {
  // Controlled reproduction of the screenshot's checks, not current company data.
  const v=input();v.annuals[0].payoutBps=10021;v.annuals[0].fcfCoverageBps=12664;
  const p=calculateDividendPricing(v);
  assert.deepEqual(p.blockers,[]);assert.equal(p.canApply,true);assert.equal(p.status,'ready');
  assert.equal(p.earningsDividendMicros,500000);assert.equal(p.fcfDividendCapMicros,422133);assert.equal(p.d1Micros,500000);
  assert.equal(p.theoreticalPriceMinor,1000);assert.deepEqual(p.grid.map(level=>level.priceMinor),[909,869,833,769]);
  assert.deepEqual(p.pauseReasons,['payout_above_100','fcf_below_150']);
  const readable=JSON.stringify(dividendPricingReadable(p));
  assert.match(readable,/historical payout exceeds earnings|Historical payout exceeds earnings/i);
  assert.doesNotMatch(readable,/payout_above_100|fcf_below_150/);
  v.annuals.forEach(year=>{year.payoutBps=10021;});
  assert.equal(calculateDividendPricing(v).sustainablePayoutBps,10000);
  assert.equal(calculateDividendPricing(v).d1Micros,500000);
});

test('missing, invalid and stale quotes preserve valuation without reporting a quote yield or reached prices', () => {
  const quotes = [
    { priceMinor:undefined, priceDate:undefined },
    ...[0,-1,1000.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity].map(priceMinor=>({priceMinor,priceDate:asOf})),
    { priceMinor:100, priceDate:'2026-01-01' },
    { priceMinor:100, priceDate:'2026-10-22' },
  ];
  for (const quote of quotes) {
    const p=calculateDividendPricing({...input(),...quote,currentCashYieldBps:600});
    assert.equal(p.canApply,true);assert.equal(p.theoreticalPriceMinor,1000);assert.equal(p.grid.length,4);
    assert.ok(p.pauseReasons?.includes('quote_missing'));assert.ok(p.grid.every(level=>level.changeFromCurrentBps===undefined));
    assert.ok(!p.pauseReasons?.includes('implausible_yield'));
    assert.equal(p.currentSpreadBps,undefined);assert.equal(p.spreadPercentileBps,undefined);
    assert.deepEqual(dividendPricingMarketComparison(p),{quoteUsable:false,estimateGapBps:undefined,reachedBuyLevels:[],sustainableYieldAtQuoteBps:undefined,largeDiscount:false});
    assert.equal(dividendPricingReadable(p)['Four fixed-yield buy prices'][0]['Change from current price percent'],null);
  }
});
test('the unusual quote-yield review starts strictly above 30 percent and remains advisory', () => {
  const v=input();v.trailingDividend.dpsMicros=600000;
  v.annuals.forEach(year=>Object.assign(year,{epsMicros:1200000,adjustedEpsMicros:1200000,dividendMicros:600000}));
  for (const [priceMinor,expectedYieldBps,unusual] of [[200,3000,false],[199,3015,true]] as const) {
    const p=calculateDividendPricing({...v,priceMinor});
    assert.equal(p.d1Micros,600000);assert.equal(p.canApply,true);
    assert.equal(p.pauseReasons?.includes('implausible_yield'),unusual);
    assert.ok(!p.blockers.includes('implausible_yield'));
    assert.equal(dividendPricingMarketComparison(p).sustainableYieldAtQuoteBps,expectedYieldBps);
  }
});
test('spread percentile compares implemented trailing dividends on both sides rather than mixing sustainable D1', () => {
  const v={...input(),currentCashYieldBps:600};const p=calculateDividendPricing(v);
  assert.equal(p.currentSpreadBps,400);assert.equal(p.spreadPercentileBps,10000);
});
test('current spread requires a safe nonnegative implemented-cash yield and accepts a reported zero', () => {
  for (const currentCashYieldBps of [undefined,-1,600.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity]) {
    const p=calculateDividendPricing({...input(),currentCashYieldBps});
    assert.equal(p.currentSpreadBps,undefined);assert.equal(p.spreadPercentileBps,undefined);
    assert.equal(p.d1Micros,500000);assert.equal(p.theoreticalPriceMinor,1000);
  }
  const zero=calculateDividendPricing({...input(),currentCashYieldBps:0});
  assert.equal(zero.currentSpreadBps,-200);assert.equal(zero.spreadPercentileBps,0);
});
test('current spread excludes missing, invalid, stale and future treasury evidence without changing the primary price', () => {
  const v=input(), currentCashYieldBps=600;
  const treasuries=[undefined,
    ...[-1,3000,200.5,NaN,Infinity].map(yieldBps=>({...v.treasury,yieldBps})),
    {...v.treasury,sourceUrl:''},
    {...v.treasury,asOf:'2026-10-10'},
    {...v.treasury,asOf:'2026-10-22'},
    {...v.treasury,asOf:'2026-02-30'},
  ];
  for (const treasury of treasuries) {
    const p=calculateDividendPricing({...v,treasury,currentCashYieldBps});
    assert.equal(p.currentSpreadBps,undefined);assert.equal(p.spreadPercentileBps,undefined);
    assert.equal(p.d1Micros,500000);assert.equal(p.theoreticalPriceMinor,1000);
  }
  const boundary=calculateDividendPricing({...v,priceDate:'2026-10-11',treasury:{...v.treasury,asOf:'2026-10-11'},currentCashYieldBps});
  assert.equal(boundary.currentSpreadBps,400);assert.equal(boundary.spreadPercentileBps,10000);
});
test('unusable historical coverage preserves a valid current spread but cannot report a spread percentile', () => {
  const histories=[undefined,
    {...structuredClone(history),capitalActionsVerified:false},
    {...structuredClone(history),cashDistributionsComplete:false},
    {...structuredClone(history),through:'2026-01-28'},
    {...structuredClone(history),samples:history.samples.slice(-59)},
  ];
  for (const history of histories) {
    const p=calculateDividendPricing({...input(),history,currentCashYieldBps:600});
    assert.equal(p.historyCoverage?.usable,false);assert.equal(p.currentSpreadBps,400);
    assert.equal(p.spreadPercentileBps,undefined);
    assert.equal(p.d1Micros,500000);assert.equal(p.theoreticalPriceMinor,1000);
  }
});
test('spread percentiles give each valid completed month one vote and ignore the current month and future observations', () => {
  const h=structuredClone(history);
  h.samples=h.samples.slice(-60).map((sample,index)=>({...sample,treasuryBps:index<30?400:0,spreadBps:index<30?100:500}));
  h.samples.push(...Array.from({length:10},()=>({...h.samples[0]})),
    {date:'2026-10-01',yieldBps:500,treasuryBps:400,spreadBps:100},
    {date:'2027-01-28',yieldBps:500,treasuryBps:400,spreadBps:100});
  const p=calculateDividendPricing({...input(),history:h,currentCashYieldBps:600});
  assert.equal(p.historyCoverage?.usable,true);assert.equal(p.historyCoverage?.sampleCount,60);
  assert.equal(p.currentSpreadBps,400);assert.equal(p.spreadPercentileBps,5000);
  assert.equal(p.d1Micros,500000);assert.equal(p.theoreticalPriceMinor,1000);
});
test('fewer than 60 consistent treasury-backed spread months cannot be filled by invalid, duplicated, current or future rows', () => {
  const badSpreads=[
    {spreadBps:undefined}, {treasuryBps:undefined}, {spreadBps:300.5}, {spreadBps:NaN}, {spreadBps:Infinity},
    {spreadBps:Number.MAX_SAFE_INTEGER+1}, {spreadBps:301},
    {treasuryBps:-1,spreadBps:501}, {treasuryBps:3000,spreadBps:-2500},
    {treasuryBps:200.5,spreadBps:299.5}, {treasuryBps:NaN}, {treasuryBps:Infinity},
  ];
  for (const invalid of badSpreads) {
    const h=structuredClone(history);h.samples=h.samples.slice(-60);
    Object.assign(h.samples[0],invalid);
    h.samples.push({...h.samples[1]},
      {date:'2026-10-01',yieldBps:500,treasuryBps:200,spreadBps:300},
      {date:'2027-01-28',yieldBps:500,treasuryBps:200,spreadBps:300});
    const p=calculateDividendPricing({...input(),history:h,currentCashYieldBps:600});
    assert.equal(p.historyCoverage?.usable,true);assert.equal(p.historyCoverage?.sampleCount,60);
    assert.equal(p.currentSpreadBps,400);assert.equal(p.spreadPercentileBps,undefined);
    assert.equal(p.d1Micros,500000);assert.equal(p.theoreticalPriceMinor,1000);
  }
});
test('a consistent negative historical spread remains a usable signed observation', () => {
  const h=structuredClone(history);
  h.samples=h.samples.slice(-60).map(sample=>({...sample,treasuryBps:600,spreadBps:-100}));
  const p=calculateDividendPricing({...input(),history:h,currentCashYieldBps:100});
  assert.equal(p.currentSpreadBps,-100);assert.equal(p.spreadPercentileBps,10000);
});
test('auxiliary-anchor disagreement cannot move the fixed 5% reference or the trading ladder', () => {
  const v=input();v.opportunity.yieldBps=700;let p=calculateDividendPricing(v);
  assert.ok(!p.blockers.includes('anchors_conflict'));
  assert.equal(p.anchors.medianBps,500);assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchors.selection,'fixed_classic');
  assert.equal(p.anchorPriceMinor,1000);assert.equal(p.canApply,true);assert.equal(p.grid.length,4);
  v.opportunity.yieldBps=1000;p=calculateDividendPricing(v);
  assert.equal(p.theoreticalPriceMinor,1000);assert.deepEqual(p.grid.map(g=>g.priceMinor),[909,869,833,769]);
});

test('crossing the former 100bp anchor threshold no longer creates a discontinuous price jump', () => {
  const v=input();v.opportunity.yieldBps=600;
  const before=calculateDividendPricing(v);
  assert.equal(before.anchors.rangeBps,100);assert.equal(before.anchors.medianBps,500);
  v.opportunity.yieldBps=601;const after=calculateDividendPricing(v);
  assert.equal(after.anchors.rangeBps,101);assert.equal(after.anchors.medianBps,500);
  for(const p of [before,after]) { assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchors.selection,'fixed_classic');assert.equal(p.theoreticalPriceMinor,1000); }
  assert.deepEqual(after.grid,before.grid);
});

test('a low comparison yield cannot manufacture extremely high selling prices', () => {
  const v=input();
  const p=calculateDividendPricing({...v,treasury:undefined,history:undefined,opportunity:{...v.opportunity,yieldBps:10}});
  assert.equal(p.anchors.opportunityCostBps,10);assert.equal(p.anchors.selectedBps,500);assert.equal(p.theoreticalPriceMinor,1000);
  const plan=dividendPricingPlan(p);assert.ok(plan);
  assert.deepEqual(plan.sellLevels.map(level=>level.yieldBps),[480,450,420,400]);
  assert.deepEqual(plan.sellLevels.map(level=>level.priceMinor),[1041,1111,1190,1250]);
  assert.deepEqual(plan.sellLevels.map(level=>level.portionBps),[2500,2500,2500,2500]);
});

test('extremely low comparison yields cannot merge the fixed selling levels', () => {
  const v=input();
  for(const yieldBps of [1,7]) {
    const p=calculateDividendPricing({...v,treasury:undefined,history:undefined,opportunity:{...v.opportunity,yieldBps}});
    assert.equal(p.canApply,true);assert.equal(p.anchors.selectedBps,500);
    assert.deepEqual(dividendPricingPlan(p)?.sellLevels.map(level=>level.yieldBps),[480,450,420,400]);
  }
});

test('unverified capital adjustments exclude the history anchor without cancelling the conservative grid', () => {
  const v=input();v.history.capitalActionsVerified=false;const p=calculateDividendPricing(v);
  assert.equal(p.anchors.historicalPercentileBps,undefined);
  assert.ok(p.warnings.includes('capital_actions_unverified'));
  assert.equal(p.canApply,true);assert.equal(p.grid.length,4);
});
test('partial auxiliary anchors stay visible but cannot replace the fixed reference yield', () => {
  const v=input();v.opportunity.sourceUrl='';v.history.samples.forEach(sample=>{sample.yieldBps=600;});
  const p=calculateDividendPricing(v);
  assert.ok(p.warnings.includes('opportunity_cost_missing'));assert.deepEqual(p.blockers,[]);assert.equal(p.canApply,true);
  assert.equal(p.anchors.opportunityCostBps,undefined);assert.equal(p.anchors.medianBps,550);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchors.selection,'fixed_classic');assert.equal(p.theoreticalPriceMinor,1000);
});

test('stale comparisons retain their source dates and review warnings without blocking verified TTM prices', () => {
  const v=input();v.treasury.asOf='2026-09-01';v.opportunity.asOf='2026-09-01';v.opportunity.yieldBps=1500;
  let p=calculateDividendPricing(v);
  assert.equal(p.canApply,true);assert.equal(p.anchors.riskFreePlusPremiumBps,undefined);assert.equal(p.anchors.opportunityCostBps,undefined);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.theoreticalPriceMinor,1000);
  assert.ok(p.warnings.includes('treasury_stale'));assert.ok(p.warnings.includes('opportunity_cost_stale'));
  assert.equal(p.opportunity?.asOf,'2026-09-01');assert.equal(p.treasury?.asOf,'2026-09-01');
  v.history.through='2026-01-31';p=calculateDividendPricing(v);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchors.selection,'fixed_classic');assert.equal(p.canApply,true);
  assert.ok(p.warnings.includes('yield_history_missing'));assert.equal(p.anchorPriceMinor,1000);
  assert.equal(p.theoreticalPriceMinor,1000);assert.equal(p.gordonPriceMinor,625);assert.equal(p.grid.length,4);assert.deepEqual(p.blockers,[]);
});

test('missing all three comparison anchors does not prevent a verified fixed-yield plan', () => {
  const v=input();v.annuals.forEach(year=>{delete year.roeBps;});
  const p=calculateDividendPricing({...v,treasury:undefined,history:undefined,opportunity:undefined,bvpsMicros:undefined});
  assert.equal(p.canApply,true);assert.deepEqual(p.blockers,[]);assert.equal(p.theoreticalPriceMinor,1000);assert.equal(p.gordonPriceMinor,625);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchors.medianBps,undefined);assert.equal(p.anchorPriceMinor,1000);
  assert.equal(p.reasonablePbBps,undefined);assert.equal(p.pbBridgePriceMinor,undefined);
  assert.deepEqual(new Set(p.warnings),new Set(['treasury_missing','yield_history_missing','opportunity_cost_missing','roe_bps_missing']));
  assert.equal(dividendPricingPlan(p)?.buyLevels.length,4);
});

test('nonpositive and future-dated auxiliary yields are excluded without disturbing fixed prices', () => {
  const v=input();v.opportunity.yieldBps=-100;v.treasury.asOf='2027-01-01';v.history.samples.forEach(sample=>{sample.yieldBps=0;});
  const p=calculateDividendPricing(v);
  assert.equal(p.canApply,true);assert.equal(p.anchors.selectedBps,500);assert.equal(p.theoreticalPriceMinor,1000);
  assert.ok(p.warnings.includes('opportunity_cost_missing'));assert.ok(p.warnings.includes('treasury_stale'));assert.ok(p.warnings.includes('yield_history_missing'));
});

test('eligibility checks remain advisory while preserving the calculated fixed-yield grids', () => {
  const v=input();v.annuals[0].payoutBps=10001;v.annuals[0].fcfCoverageBps=14999;let p=calculateDividendPricing(v);
  assert.ok(p.pauseReasons?.includes('payout_above_100'));assert.ok(p.warnings.includes('fcf_below_150'));assert.equal(p.canApply,true);assert.equal(p.grid.length,4);assert.deepEqual(p.blockers,[]);
  const bank=input();bank.financialSector=true;bank.method.riskPremiumBps.bank=300;bank.annuals.forEach(y=>delete y.fcfCoverageBps);
  p=calculateDividendPricing(bank);assert.equal(p.canApply,true);assert.ok(p.pauseReasons?.includes('financial_sector_review'));
  const reviewedBank={...bank,financialReview:{sector:'bank' as const,status:'pass' as const,asOf:'2026-06-30',metrics:[],missing:[],sourceUrl:'https://example.com/review',policySourceUrls:[],basis:'dividend_screen' as const}};
  p=calculateDividendPricing(reviewedBank);assert.equal(p.canApply,true);assert.ok(!p.warnings.includes('financial_sector_review'));
  assert.ok(calculateDividendPricing({...reviewedBank,financialReview:{...reviewedBank.financialReview,status:'risk'}}).pauseReasons?.includes('financial_sector_review'));
  const g=input();g.method.growthBps=300;g.method.requiredReturnBps=500;assert.ok(calculateDividendPricing(g).pauseReasons?.includes('growth_return_conflict'));
});
test('synthetic Midea cash-flow stress preserves its diagnostic ceiling without overwriting implemented TTM cash', () => {
  // Controlled inputs reproduce the reported concern, not current Midea data.
  const v={...input(),code:'000333',name:'美的集团',priceMinor:8600,bvpsMicros:30000000,trailingDividend:trailingDividend(3000000)};
  v.annuals.forEach((year,index)=>Object.assign(year,{epsMicros:5000000,adjustedEpsMicros:5000000,payoutBps:6000,
    dividendMicros:3000000,roeBps:1500,totalShares:100,operatingCashMinor:([47000,62000,59000][index] ?? 65000),
    capitalExpenditureMinor:20000,dividendCashMinor:30000,fcfCoverageBps:([9000,14000,13000][index] ?? 15000)}));
  const p=calculateDividendPricing(v);
  assert.equal(p.earningsDividendMicros,3000000);assert.equal(p.fcfDividendCapMicros,1800000);assert.equal(p.d1Micros,3000000);
  assert.equal(p.fcfCapApplied,false);assert.equal(p.canApply,true);assert.deepEqual(p.blockers,[]);
  assert.ok(p.warnings.includes('fcf_below_150'));assert.equal(p.warnings.filter(w=>w==='fcf_below_150').length,1);
  assert.deepEqual(p.fcfEvidence?.map(y=>[y.year,y.fcfPerShareMicros,y.dividendCapMicros,y.basis]),[
    [2025,2700000,1800000,'reported_cash_flow_per_share'],[2024,4200000,2800000,'reported_cash_flow_per_share'],[2023,3900000,2600000,'reported_cash_flow_per_share']]);
  assert.equal(p.theoreticalPriceMinor,6000);assert.deepEqual(p.grid.map(g=>g.priceMinor),[5454,5217,5000,4615]);
  v.method.holdingPeriod='month_to_year';assert.equal(calculateDividendPricing(v).d1Micros,2700000);
});

test('documented dividend coverage remains a diagnostic fallback while reported cash flow takes precedence', () => {
  const v=input();v.annuals[0].fcfCoverageBps=12000;
  let p=calculateDividendPricing(v);
  assert.equal(p.fcfDividendCapMicros,400000);assert.equal(p.d1Micros,500000);assert.equal(p.canApply,true);
  assert.equal(p.fcfEvidence?.[0].basis,'reported_dividend_coverage');
  Object.assign(v.annuals[0],{operatingCashMinor:5500,capitalExpenditureMinor:1000,totalShares:100,dividendCashMinor:5000,fcfCoverageBps:20000});
  p=calculateDividendPricing(v);
  assert.equal(p.fcfDividendCapMicros,300000);assert.equal(p.d1Micros,500000);assert.equal(p.fcfEvidence?.[0].basis,'reported_cash_flow_per_share');
});

test('missing earnings and nonpositive industrial cash support stay explicit as reviews without replacing verified TTM', () => {
  for(const coverage of [undefined,0,-1000]) {
    const v=input();v.annuals[0].fcfCoverageBps=coverage;
    const p=calculateDividendPricing(v);
    assert.equal(p.canApply,true);assert.equal(p.grid.length,4);assert.deepEqual(p.blockers,[]);
    assert.ok(p.pauseReasons?.includes(coverage===undefined?'fcf_missing':'fcf_non_positive'));
    assert.equal(p.d1Micros,500000);
  }
  const raw=input();Object.assign(raw.annuals[0],{operatingCashMinor:1000,capitalExpenditureMinor:2000,totalShares:100,fcfCoverageBps:20000});
  assert.ok(calculateDividendPricing(raw).pauseReasons?.includes('fcf_non_positive'));
  const earnings=input();earnings.annuals.slice(0,3).forEach(year=>{year.adjustedEpsMicros=-100;});
  assert.ok(calculateDividendPricing(earnings).pauseReasons?.includes('non_positive_earnings'));
  delete earnings.annuals[0].adjustedEpsMicros;
  assert.ok(calculateDividendPricing(earnings).pauseReasons?.includes('annual_eps_missing'));
  assert.equal(calculateDividendPricing(earnings).canApply,true);
});

test('synthetic Agricultural Bank keeps comparison disagreement separate from fixed prices and skips industrial FCF rules', () => {
  const v={...input(),code:'601288',name:'农业银行',financialSector:true,priceMinor:600,bvpsMicros:8000000,trailingDividend:trailingDividend(195000),
    financialReview:{sector:'bank' as const,status:'pass' as const,asOf:'2026-06-30',metrics:[],missing:[],sourceUrl:'https://example.com/bank-review',policySourceUrls:[],basis:'dividend_screen' as const}};
  v.annuals.forEach(year=>Object.assign(year,{epsMicros:650000,adjustedEpsMicros:650000,payoutBps:3000,dividendMicros:195000,roeBps:1200,fcfCoverageBps:-5000}));
  v.history.samples.forEach(sample=>{sample.yieldBps=900;});v.opportunity.yieldBps=409;v.treasury.yieldBps=164;
  const p=calculateDividendPricing(v);
  assert.equal(p.riskClass,'bank');assert.equal(p.canApply,true);assert.deepEqual(p.blockers,[]);
  assert.equal(p.anchors.medianBps,409);assert.equal(p.anchors.selectedBps,500);assert.equal(p.anchorPriceMinor,390);
  assert.equal(p.theoreticalPriceMinor,390);assert.deepEqual(p.grid.map(g=>g.priceMinor),[354,339,325,300]);
  assert.equal(p.fcfDividendCapMicros,undefined);assert.equal(p.fcfCapApplied,false);assert.deepEqual(p.fcfEvidence,[]);
  assert.ok(!p.pauseReasons?.includes('fcf_non_positive'));
  assert.ok(calculateDividendPricing({...v,financialReview:{...v.financialReview,status:'risk'}}).pauseReasons?.includes('financial_sector_review'));
});

test('cyclical normalisation remains an independent paused-buying review and future-dated evidence is not applied', () => {
  const v=input();v.method.stockOverrides[v.code]={riskClass:'cyclical'};v.method.riskPremiumBps.cyclical=300;
  assert.ok(calculateDividendPricing(v).pauseReasons?.includes('cyclical_normalisation_required'));
  Object.assign(v.method.stockOverrides[v.code],{normalizedEpsMicros:800000,normalizationSource:'Three reports adjusted for peak earnings',normalizationAsOf:asOf});
  assert.equal(calculateDividendPricing(v).earningsDividendMicros,400000);assert.equal(calculateDividendPricing(v).d1Micros,500000);assert.equal(calculateDividendPricing(v).canApply,true);
  v.method.stockOverrides[v.code].normalizationAsOf='2027-01-01';const future=calculateDividendPricing(v);assert.equal(future.canApply,true);assert.equal(future.d1Micros,500000);assert.ok(future.pauseReasons?.includes('cyclical_normalisation_required'));
});
test('public source fixture verifies financial/cash fields, treasury units and unadjusted monthly prices', () => {
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-public-2026-10-21.json',import.meta.url),'utf8'));
  const t=parseDividendTreasury(f.sources.treasury,asOf);assert.equal(t.yieldBps,164);assert.equal(t.asOf,'2026-10-20');
  const prices=dividendPricingPriceHistory(f.sources.month,'sh600900',asOf);assert.ok(prices.length>=100);assert.ok(prices.at(-1)!.priceMinor>0);
  const ds={success:true,result:{data:[{SECURITY_CODE:'600900',REPORT_DATE:'2025-12-31',EX_DIVIDEND_DATE:'2026-07-10',NOTICE_DATE:'2026-06-10',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:10,TOTAL_SHARES:100000000}]}};
  const years=dividendPricingAnnuals(f.sources.financial,f.sources.cash,ds,'600900',asOf);
  assert.equal(years[0].adjustedEpsMicros,f.sources.financial.result.data.find((r:Record<string,unknown>)=>r.REPORT_DATE.startsWith('2025-12-31')).EPSKCJB*1e6);
  assert.ok(years[0].operatingCashMinor!>0);assert.equal(years[0].dividendCashMinor,10000000000);
  const b=XLSX.read(readFileSync(new URL('./fixtures/dividend-index-000922-2026-10-21.xls',import.meta.url)),{type:'buffer'});
  const o=parseDividendOpportunityRows(XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]],{header:1}),asOf);
  assert.equal(o.yieldBps,409);assert.equal(o.asOf,'2026-10-20');
});
test('treasury parsing ignores future observations before selecting the latest known yield', () => {
  const future={SOLAR_DATE:'2026-10-22',EMM00166466:25};
  const p=parseDividendTreasury({success:true,result:{data:[future,
    {SOLAR_DATE:'2026-10-19',EMM00166466:1.8},
    {SOLAR_DATE:asOf,EMM00166466:2},
    {SOLAR_DATE:'2026-10-20',EMM00166466:1.9}]}},asOf,123);
  assert.equal(p.yieldBps,200);assert.equal(p.asOf,asOf);assert.equal(p.fetchedAt,123);
  assert.deepEqual(p.history,[{date:'2026-10-19',yieldBps:180},{date:'2026-10-20',yieldBps:190},{date:asOf,yieldBps:200}]);
  assert.throws(()=>parseDividendTreasury({success:true,result:{data:[future]}},asOf),/TREASURY_SOURCE_INVALID/);
});
test('captured CATL evidence includes a verified zero and omitted special cash without weakening the five-year requirement', () => {
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json',import.meta.url),'utf8'));
  const years=dividendPricingAnnuals(f.sources.financial.data,f.sources.cash.data,f.sources.distribution.data,'300750','2026-10-23');
  assert.deepEqual(years.map(year=>[year.year,year.payoutBps]),[[2025,5034],[2024,5000],[2023,5000],[2022,2521],[2021,0]]);
  assert.equal(years[4].reportEvidence?.basis,'reported_no_dividend');
  assert.equal(years[4].dividendMicros,0);
  assert.equal(years[2].dividendMicros,5028000);assert.equal(years[1].dividendMicros,5783000);
  assert.equal(years[3].payoutBasis,'reported_cash_over_profit');
  // 2022's raw pre-capitalisation DPS / restated EPS would incorrectly be 44.21%.
  assert.equal(Math.round(years[3].dividendMicros!/years[3].epsMicros!*10000),4421);
  const p=calculateDividendPricing({...input(),code:'300750',name:'宁德时代',annuals:years,asOf:'2026-10-23',trailingDividend:trailingDividend(500000,'2026-10-23')});
  assert.equal(p.normalizedEpsMicros,11797733);assert.equal(p.sustainablePayoutBps,5000);
  assert.equal(p.earningsDividendMicros,5898867);assert.equal(p.fcfDividendCapMicros,8529361);
  assert.equal(p.d1Micros,500000);assert.equal(p.canApply,true);
  assert.ok(!p.blockers.includes('annual_payout_missing'));
  const readable=dividendPricingReadable(p);
  assert.equal(readable['Annual evidence'][4]['Archival issuer disclosure, not fetched live']?.publishedAt,'2022-04-22');
});
test('archival cash evidence respects issuer, year, publication date and matching profit rather than filling arbitrary gaps', () => {
  assert.equal(dividendAnnualReportEvidence('300750',2023,'2026-03-09',4412124800000),undefined);
  assert.equal(dividendAnnualReportEvidence('600000',2021,'2026-10-23',1593131790000),undefined);
  assert.equal(dividendAnnualReportEvidence('300750',2022,'2026-10-23',3072916350000),undefined);
  assert.equal(dividendAnnualReportEvidence('300750',2021,'2026-10-23',159313179000),undefined);
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json',import.meta.url),'utf8'));
  const noProfit=structuredClone(f.sources.financial.data);
  noProfit.result.data.find((row:Record<string,unknown>)=>String(row.REPORT_DATE).startsWith('2021-12-31')).PARENTNETPROFIT=null;
  const years=dividendPricingAnnuals(noProfit,f.sources.cash.data,f.sources.distribution.data,'300750','2026-10-23');
  assert.equal(years[4].dividendMicros,undefined);assert.equal(years[4].payoutBps,undefined);
  assert.ok(calculateDividendPricing({...input(),annuals:years}).pauseReasons?.includes('annual_payout_missing'));
  const contradictory=structuredClone(f.sources.distribution.data);
  contradictory.result.data.push({SECURITY_CODE:'300750',REPORT_DATE:'2021-12-31',NOTICE_DATE:'2022-07-01',EX_DIVIDEND_DATE:'2022-07-10',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:1,TOTAL_SHARES:1000});
  const changed=dividendPricingAnnuals(f.sources.financial.data,f.sources.cash.data,contradictory,'300750','2026-10-23');
  assert.equal(changed[4].reportEvidence,undefined);assert.equal(changed[4].dividendMicros,100000);
});
test('historical yield uses only implemented cash before each sample and converts stock bonuses to the sample share basis', () => {
  const dist={success:true,result:{data:[
    {SECURITY_CODE:'600000',REPORT_DATE:'2022-12-31',EX_DIVIDEND_DATE:'2023-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:1,BONUS_RATIO:0,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2023-12-31',EX_DIVIDEND_DATE:'2024-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:10,BONUS_RATIO:10,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2024-12-31',EX_DIVIDEND_DATE:'2025-06-01',ASSIGN_PROGRESS:'董事会预案',PRETAX_BONUS_RMB:100,BONUS_RATIO:0,IT_RATIO:0}]}};
  const h=dividendPricingYieldHistory([{date:'2024-07-01',priceMinor:1000}],dist,'600000');
  assert.equal(h!.samples[0].yieldBps,500);assert.equal(h!.capitalActionsVerified,true);
});
test('captured CMB data produces a verified historical anchor from completed unadjusted months', () => {
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-history-cmb-2026-10-22.json',import.meta.url),'utf8'));
  const prices=dividendPricingPriceHistory(f.sources.month.data,'sh600036','2026-10-22');
  const h=dividendPricingYieldHistory(prices.filter(p=>p.date.slice(0,7)<'2026-10'),f.sources.distribution.data,'600036');
  const coverage=dividendPricingHistoryCoverage(h,'2026-10-22');
  assert.equal(coverage.usable,true);assert.equal(coverage.sampleCount,118);assert.equal(coverage.through,'2026-09-30');
  assert.equal(h!.samples.at(-1)!.yieldBps,489);assert.equal(h!.capitalActionsVerified,true);
  assert.equal(calculateDividendPricing({...input(),history:h}).anchors.historicalPercentileBps,489);
});
test('history coverage counts distinct completed months and reports actual shortages without lowering the gate', () => {
  const h=structuredClone(history);h.samples=h.samples.slice(-59);
  h.samples.push({...h.samples.at(-1)!},{date:'2026-10-21',yieldBps:1000});
  let coverage=dividendPricingHistoryCoverage(h,asOf);
  assert.equal(coverage.sampleCount,59);assert.equal(coverage.usable,false);assert.ok(coverage.reasons.includes('samples_insufficient'));
  h.samples=history.samples.slice(-60);coverage=dividendPricingHistoryCoverage(h,asOf);
  assert.equal(coverage.usable,true);assert.equal(coverage.sampleCount,60);
  h.through='2026-06-28';coverage=dividendPricingHistoryCoverage(h,asOf);
  assert.ok(coverage.reasons.includes('stale'));assert.equal(coverage.usable,false);
});
test('empty monthly data fails parsing and repeated monthly rows cannot manufacture observations', () => {
  assert.throws(()=>dividendPricingPriceHistory({code:0,data:{sh600036:{month:[]}}},'sh600036',asOf),/PRICE_HISTORY_EMPTY/);
  const rows=[['2026-09-29','40','41'],['2026-09-30','40','42'],null,['2026-10-22','40','43']];
  assert.deepEqual(dividendPricingPriceHistory({code:0,data:{sh600036:{month:rows}}},'sh600036',asOf),[{date:'2026-09-30',priceMinor:4200}]);
});
