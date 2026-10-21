import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { calculateDividendPricing, defaultDividendPricingMethod, dividendPricingAnnuals, dividendPricingPriceHistory, dividendPricingYieldHistory,
  parseDividendTreasury, parseDividendOpportunityRows, dividendPricingReadable, type DividendYieldHistory, type DividendPricingAnnual } from '../src/lib/dividendPricing.ts';

const asOf = '2026-10-21';
const annuals: DividendPricingAnnual[] = Array.from({length:5},(_,i) => ({year:2025-i,reportDate:`${2025-i}-12-31`,noticeDate:`${2026-i}-03-20`,
  epsMicros:1000000,adjustedEpsMicros:1000000,roeBps:1000,dividendMicros:500000,payoutBps:5000,fcfCoverageBps:20000}));
const history: DividendYieldHistory = {basis:'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close',capitalActionsVerified:true,from:'2016-01-31',through:'2026-09-30',sourceUrls:[],
  samples:Array.from({length:120},(_,i) => ({date:`${2016+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}-28`,yieldBps:500,spreadBps:300}))};
function input() { return {code:'600000',name:'Fixture',financialSector:false,method:defaultDividendPricingMethod(),annuals:structuredClone(annuals),asOf,
  history:structuredClone(history),treasury:{yieldBps:200,asOf,fetchedAt:1,history:[],sourceUrl:'https://example.com/treasury'},
  opportunity:{yieldBps:500,asOf,sourceUrl:'https://example.com/comparison',basis:'Dated comparator'},priceMinor:1000,priceDate:asOf,bvpsMicros:20000000}; }

test('independent arithmetic: three-year recurring earnings, five-year payout, three anchors and conservative price ceiling', () => {
  const p=calculateDividendPricing(input());
  assert.equal(p.canApply,true); assert.equal(p.d1Micros,500000); assert.equal(p.anchors.medianBps,500);
  assert.equal(p.gordonPriceMinor,625); assert.equal(p.anchorPriceMinor,1000); assert.equal(p.pbBridgePriceMinor,2000);
  assert.equal(p.theoreticalPriceMinor,625); assert.equal(p.marginPriceMinor,531);
  assert.deepEqual(p.grid.map(g=>g.priceMinor),[593,531,468]);
  assert.deepEqual(p.grid.map(g=>g.cumulativePortionBps),[3333,6666,10000]);
  assert.deepEqual(p.grid.map(g=>g.meetsSafetyMargin),[false,true,true]);
  assert.doesNotMatch(JSON.stringify(dividendPricingReadable(p)),/priceMinor|d1Micros|fcfCoverageBps/);
});
test('growth changes the Gordon denominator once and tax changes the cash numerator once', () => {
  const v=input();v.method.growthBps=100;v.method.holdingPeriod='month_to_year';const p=calculateDividendPricing(v);
  assert.equal(p.d1Micros,450000);assert.equal(p.gordonYieldBps,700);assert.equal(p.gordonPriceMinor,642);
});
test('spread percentile compares implemented trailing dividends on both sides rather than mixing sustainable D1', () => {
  const v={...input(),currentCashYieldBps:600};const p=calculateDividendPricing(v);
  assert.equal(p.currentSpreadBps,400);assert.equal(p.spreadPercentileBps,10000);
});
test('missing anchors and anchor disagreement block executable prices without hiding the specific gap', () => {
  const v=input();v.opportunity.yieldBps=700;let p=calculateDividendPricing(v);
  assert.ok(p.blockers.includes('anchors_conflict')); assert.equal(p.canApply,false);assert.equal(p.theoreticalPriceMinor,undefined);assert.deepEqual(p.grid,[]);
  v.opportunity.sourceUrl='';p=calculateDividendPricing(v);assert.ok(p.blockers.includes('opportunity_cost_missing'));
  v.history.samples=[];p=calculateDividendPricing(v);assert.ok(p.blockers.includes('yield_history_missing'));
});
test('payout, financial coverage, loss and growth guard stop pricing; financial-sector pricing requires a completed numeric review', () => {
  const v=input();v.annuals[0].payoutBps=10001;v.annuals[0].fcfCoverageBps=14999;let p=calculateDividendPricing(v);
  assert.ok(p.blockers.includes('payout_above_100'));assert.ok(p.blockers.includes('fcf_below_150'));assert.equal(p.canApply,false);
  const bank=input();bank.financialSector=true;bank.method.riskPremiumBps.bank=300;bank.annuals.forEach(y=>delete y.fcfCoverageBps);
  p=calculateDividendPricing(bank);assert.equal(p.canApply,false);assert.ok(p.blockers.includes('financial_sector_review'));
  const reviewedBank={...bank,financialReview:{sector:'bank' as const,status:'pass' as const,asOf:'2026-06-30',metrics:[],missing:[],sourceUrl:'https://example.com/review',policySourceUrls:[],basis:'dividend_screen' as const}};
  p=calculateDividendPricing(reviewedBank);assert.equal(p.canApply,true);assert.ok(!p.warnings.includes('financial_sector_review'));
  assert.ok(calculateDividendPricing({...reviewedBank,financialReview:{...reviewedBank.financialReview,status:'risk'}}).blockers.includes('financial_sector_review'));
  const g=input();g.method.growthBps=300;g.method.requiredReturnBps=500;assert.ok(calculateDividendPricing(g).blockers.includes('growth_return_conflict'));
});
test('a cyclical company needs dated normalised earnings, and a future date is not valid evidence', () => {
  const v=input();v.method.stockOverrides[v.code]={riskClass:'cyclical'};v.method.riskPremiumBps.cyclical=300;
  assert.ok(calculateDividendPricing(v).blockers.includes('cyclical_normalisation_required'));
  Object.assign(v.method.stockOverrides[v.code],{normalizedEpsMicros:800000,normalizationSource:'Three reports adjusted for peak earnings',normalizationAsOf:asOf});
  assert.equal(calculateDividendPricing(v).d1Micros,400000);assert.equal(calculateDividendPricing(v).canApply,true);
  v.method.stockOverrides[v.code].normalizationAsOf='2027-01-01';assert.equal(calculateDividendPricing(v).canApply,false);
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
test('historical yield uses only implemented cash before each sample and converts stock bonuses to the sample share basis', () => {
  const dist={success:true,result:{data:[
    {SECURITY_CODE:'600000',REPORT_DATE:'2022-12-31',EX_DIVIDEND_DATE:'2023-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:1,BONUS_RATIO:0,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2023-12-31',EX_DIVIDEND_DATE:'2024-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:10,BONUS_RATIO:10,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2024-12-31',EX_DIVIDEND_DATE:'2025-06-01',ASSIGN_PROGRESS:'董事会预案',PRETAX_BONUS_RMB:100,BONUS_RATIO:0,IT_RATIO:0}]}};
  const h=dividendPricingYieldHistory([{date:'2024-07-01',priceMinor:1000}],dist,'600000');
  assert.equal(h!.samples[0].yieldBps,500);assert.equal(h!.capitalActionsVerified,true);
});
