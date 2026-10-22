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

test('independent arithmetic: three-year recurring earnings, five-year payout and primary three-anchor price independent of Gordon/PB', () => {
  const p=calculateDividendPricing(input());
  assert.equal(p.canApply,true); assert.equal(p.d1Micros,500000); assert.equal(p.anchors.medianBps,500);
  assert.equal(p.gordonPriceMinor,625); assert.equal(p.anchorPriceMinor,1000); assert.equal(p.pbBridgePriceMinor,2000);
  assert.equal(p.theoreticalPriceMinor,1000); assert.equal(p.marginPriceMinor,850);
  assert.deepEqual(p.grid.map(g=>g.priceMinor),[950,850,750]);
  assert.deepEqual(p.grid.map(g=>g.cumulativePortionBps),[3333,6666,10000]);
  assert.deepEqual(p.grid.map(g=>g.meetsSafetyMargin),[false,true,true]);
  assert.doesNotMatch(JSON.stringify(dividendPricingReadable(p)),/priceMinor|d1Micros|fcfCoverageBps/);
});
test('growth changes the Gordon denominator once and tax changes the cash numerator once', () => {
  const v=input();v.method.growthBps=100;v.method.holdingPeriod='month_to_year';const p=calculateDividendPricing(v);
  assert.equal(p.d1Micros,450000);assert.equal(p.gordonYieldBps,700);assert.equal(p.gordonPriceMinor,642);
});
test('lower Gordon and PB comparisons do not cap the primary three-anchor valuation', () => {
  const v=input();v.annuals.forEach(year=>{year.roeBps=100;});
  const p=calculateDividendPricing(v);
  assert.equal(p.gordonPriceMinor,625);assert.equal(p.pbBridgePriceMinor,200);
  assert.equal(p.anchorPriceMinor,1000);assert.equal(p.theoreticalPriceMinor,1000);
  assert.deepEqual(p.grid.map(level=>level.priceMinor),[950,850,750]);
});
test('reported 100.21% payout and 126.64% positive cash coverage keep a cash-capped paused three-level draft', () => {
  // Controlled reproduction of the screenshot's checks, not current company data.
  const v=input();v.annuals[0].payoutBps=10021;v.annuals[0].fcfCoverageBps=12664;
  const p=calculateDividendPricing(v);
  assert.deepEqual(p.blockers,[]);assert.equal(p.canApply,true);assert.equal(p.status,'ready');
  assert.equal(p.earningsDividendMicros,500000);assert.equal(p.d1Micros,422133);
  assert.equal(p.theoreticalPriceMinor,844);assert.deepEqual(p.grid.map(level=>level.priceMinor),[801,717,633]);
  assert.deepEqual(p.pauseReasons,['payout_above_100','fcf_below_150']);
  const readable=JSON.stringify(dividendPricingReadable(p));
  assert.match(readable,/historical payout exceeds earnings|Historical payout exceeds earnings/i);
  assert.doesNotMatch(readable,/payout_above_100|fcf_below_150/);
  v.annuals.forEach(year=>{year.payoutBps=10021;});
  assert.equal(calculateDividendPricing(v).sustainablePayoutBps,10000);
});
test('missing or stale current quotes pause buying without erasing an independently calculated valuation', () => {
  for (const missing of [true,false]) {
    const v=input();const p=calculateDividendPricing({...v,priceMinor:missing?undefined:v.priceMinor,priceDate:missing?undefined:'2026-01-01'});
    assert.equal(p.canApply,true);assert.equal(p.theoreticalPriceMinor,1000);assert.equal(p.grid.length,3);
    assert.ok(p.pauseReasons?.includes('quote_missing'));assert.ok(p.grid.every(level=>level.changeFromCurrentBps===undefined));
    assert.equal(dividendPricingReadable(p)['Three exact grid prices'][0]['Change from current price percent'],null);
  }
});
test('spread percentile compares implemented trailing dividends on both sides rather than mixing sustainable D1', () => {
  const v={...input(),currentCashYieldBps:600};const p=calculateDividendPricing(v);
  assert.equal(p.currentSpreadBps,400);assert.equal(p.spreadPercentileBps,10000);
});
test('anchor disagreement chooses the highest required cash yield and keeps the conflict visible as a review', () => {
  const v=input();v.opportunity.yieldBps=700;let p=calculateDividendPricing(v);
  assert.ok(p.warnings.includes('anchors_conflict'));assert.ok(!p.blockers.includes('anchors_conflict'));
  assert.equal(p.anchors.medianBps,500);assert.equal(p.anchors.selectedBps,700);assert.equal(p.anchors.selection,'highest_available');
  assert.equal(p.anchorPriceMinor,714);assert.equal(p.canApply,true);assert.equal(p.grid.length,3);
  v.opportunity.yieldBps=1000;p=calculateDividendPricing(v);
  assert.equal(p.theoreticalPriceMinor,500);assert.deepEqual(p.grid.map(g=>g.priceMinor),[475,425,375]);
});
test('unverified capital adjustments exclude the history anchor without cancelling the conservative grid', () => {
  const v=input();v.history.capitalActionsVerified=false;const p=calculateDividendPricing(v);
  assert.equal(p.anchors.historicalPercentileBps,undefined);
  assert.ok(p.warnings.includes('capital_actions_unverified'));
  assert.equal(p.canApply,true);assert.equal(p.grid.length,3);
});
test('partial auxiliary anchors use the highest usable value while keeping missing comparisons visible', () => {
  const v=input();v.opportunity.sourceUrl='';v.history.samples.forEach(sample=>{sample.yieldBps=600;});
  const p=calculateDividendPricing(v);
  assert.ok(p.warnings.includes('opportunity_cost_missing'));assert.deepEqual(p.blockers,[]);assert.equal(p.canApply,true);
  assert.equal(p.anchors.opportunityCostBps,undefined);assert.equal(p.anchors.medianBps,550);
  assert.equal(p.anchors.selectedBps,600);assert.equal(p.anchors.selection,'highest_available');
  assert.ok(!p.warnings.includes('anchors_conflict'));
});
test('stale auxiliary anchors are excluded from prices and retain their source dates and review warnings', () => {
  const v=input();v.treasury.asOf='2026-09-01';v.opportunity.asOf='2026-09-01';v.opportunity.yieldBps=1500;
  let p=calculateDividendPricing(v);
  assert.equal(p.canApply,true);assert.equal(p.anchors.riskFreePlusPremiumBps,undefined);assert.equal(p.anchors.opportunityCostBps,undefined);
  assert.equal(p.anchors.selectedBps,500);assert.equal(p.theoreticalPriceMinor,1000);
  assert.ok(p.warnings.includes('treasury_stale'));assert.ok(p.warnings.includes('opportunity_cost_stale'));
  assert.equal(p.opportunity?.asOf,'2026-09-01');assert.equal(p.treasury?.asOf,'2026-09-01');
  v.history.through='2026-01-31';p=calculateDividendPricing(v);
  assert.equal(p.anchors.selectedBps,undefined);assert.equal(p.anchors.selection,undefined);assert.equal(p.canApply,false);
  assert.ok(p.warnings.includes('yield_history_missing'));assert.equal(p.anchorPriceMinor,undefined);assert.equal(p.pbBridgePriceMinor,undefined);
  assert.equal(p.theoreticalPriceMinor,undefined);assert.equal(p.gordonPriceMinor,625);assert.deepEqual(p.grid,[]);assert.ok(p.blockers.includes('anchors_missing'));
});
test('missing all three anchors retains Gordon as a comparison without substituting it for the requested primary method', () => {
  const v=input();v.annuals.forEach(year=>{delete year.roeBps;});
  const p=calculateDividendPricing({...v,treasury:undefined,history:undefined,opportunity:undefined,bvpsMicros:undefined});
  assert.equal(p.canApply,false);assert.deepEqual(p.blockers,['anchors_missing']);assert.equal(p.theoreticalPriceMinor,undefined);assert.equal(p.gordonPriceMinor,625);
  assert.equal(p.anchors.selectedBps,undefined);assert.equal(p.anchors.medianBps,undefined);assert.equal(p.anchorPriceMinor,undefined);
  assert.equal(p.reasonablePbBps,undefined);assert.equal(p.pbBridgePriceMinor,undefined);
  assert.deepEqual(new Set(p.warnings),new Set(['treasury_missing','yield_history_missing','opportunity_cost_missing','roe_bps_missing']));
  assert.equal(dividendPricingReadable(p)['Three yield anchors percent']['Selected conservative yield'],null);
});
test('nonpositive and future-dated auxiliary yields never enter a comparison price', () => {
  const v=input();v.opportunity.yieldBps=-100;v.treasury.asOf='2027-01-01';v.history.samples.forEach(sample=>{sample.yieldBps=0;});
  const p=calculateDividendPricing(v);
  assert.equal(p.canApply,false);assert.equal(p.anchors.selectedBps,undefined);assert.equal(p.theoreticalPriceMinor,undefined);
  assert.ok(p.warnings.includes('opportunity_cost_missing'));assert.ok(p.warnings.includes('treasury_stale'));assert.ok(p.warnings.includes('yield_history_missing'));
});
test('eligibility checks pause buying while preserving calculated three-anchor grids', () => {
  const v=input();v.annuals[0].payoutBps=10001;v.annuals[0].fcfCoverageBps=14999;let p=calculateDividendPricing(v);
  assert.ok(p.pauseReasons?.includes('payout_above_100'));assert.ok(p.warnings.includes('fcf_below_150'));assert.equal(p.canApply,true);assert.equal(p.grid.length,3);assert.deepEqual(p.blockers,[]);
  const bank=input();bank.financialSector=true;bank.method.riskPremiumBps.bank=300;bank.annuals.forEach(y=>delete y.fcfCoverageBps);
  p=calculateDividendPricing(bank);assert.equal(p.canApply,true);assert.ok(p.pauseReasons?.includes('financial_sector_review'));
  const reviewedBank={...bank,financialReview:{sector:'bank' as const,status:'pass' as const,asOf:'2026-06-30',metrics:[],missing:[],sourceUrl:'https://example.com/review',policySourceUrls:[],basis:'dividend_screen' as const}};
  p=calculateDividendPricing(reviewedBank);assert.equal(p.canApply,true);assert.ok(!p.warnings.includes('financial_sector_review'));
  assert.ok(calculateDividendPricing({...reviewedBank,financialReview:{...reviewedBank.financialReview,status:'risk'}}).pauseReasons?.includes('financial_sector_review'));
  const g=input();g.method.growthBps=300;g.method.requiredReturnBps=500;assert.ok(calculateDividendPricing(g).pauseReasons?.includes('growth_return_conflict'));
});
test('synthetic Midea cash-flow case caps D1 at the weakest recent FCF/share divided by 1.5 and generates reviewable grids', () => {
  // These controlled inputs reproduce the reported failure mode; they are not
  // a current valuation or a substitute for Midea's published financial data.
  const v={...input(),code:'000333',name:'美的集团',priceMinor:8600,bvpsMicros:30000000};
  v.annuals.forEach((year,index)=>Object.assign(year,{epsMicros:5000000,adjustedEpsMicros:5000000,payoutBps:6000,
    dividendMicros:3000000,roeBps:1500,totalShares:100,operatingCashMinor:([47000,62000,59000][index] ?? 65000),
    capitalExpenditureMinor:20000,dividendCashMinor:30000,fcfCoverageBps:([9000,14000,13000][index] ?? 15000)}));
  const p=calculateDividendPricing(v);
  assert.equal(p.earningsDividendMicros,3000000);assert.equal(p.fcfDividendCapMicros,1800000);assert.equal(p.d1Micros,1800000);
  assert.equal(p.fcfCapApplied,true);assert.equal(p.canApply,true);assert.deepEqual(p.blockers,[]);
  assert.ok(p.warnings.includes('fcf_below_150'));assert.ok(p.warnings.includes('fcf_dividend_capped'));
  assert.equal(p.warnings.filter(w=>w==='fcf_below_150').length,1);
  assert.deepEqual(p.fcfEvidence?.map(y=>[y.year,y.fcfPerShareMicros,y.dividendCapMicros,y.basis]),[
    [2025,2700000,1800000,'reported_cash_flow_per_share'],[2024,4200000,2800000,'reported_cash_flow_per_share'],[2023,3900000,2600000,'reported_cash_flow_per_share']]);
  assert.equal(p.theoreticalPriceMinor,3600);assert.deepEqual(p.grid.map(g=>g.priceMinor),[3420,3060,2700]);
  v.method.holdingPeriod='month_to_year';assert.equal(calculateDividendPricing(v).d1Micros,1620000);
  const readable=dividendPricingReadable(p);
  assert.equal(readable['Cash-supported pretax dividend ceiling in CNY per share at 1.5x coverage'],1.8);
  assert.equal(readable['Cash-flow ceiling reduced the dividend'],true);
});
test('documented dividend coverage is a per-share fallback and cannot exceed the reported cash-flow ceiling', () => {
  const v=input();v.annuals[0].fcfCoverageBps=12000;
  let p=calculateDividendPricing(v);
  assert.equal(p.fcfDividendCapMicros,400000);assert.equal(p.d1Micros,400000);assert.equal(p.canApply,true);
  assert.equal(p.fcfEvidence?.[0].basis,'reported_dividend_coverage');
  Object.assign(v.annuals[0],{operatingCashMinor:5500,capitalExpenditureMinor:1000,totalShares:100,dividendCashMinor:5000,fcfCoverageBps:20000});
  p=calculateDividendPricing(v);
  assert.equal(p.fcfDividendCapMicros,300000);assert.equal(p.d1Micros,300000);assert.equal(p.fcfEvidence?.[0].basis,'reported_cash_flow_per_share');
});
test('missing and nonpositive cash support still prevent executable industrial grids', () => {
  for(const coverage of [undefined,0,-1000]){
    const v=input();v.annuals[0].fcfCoverageBps=coverage;
    const p=calculateDividendPricing(v);
    assert.equal(p.canApply,false);assert.deepEqual(p.grid,[]);
    assert.ok(p.blockers.includes(coverage===undefined?'fcf_missing':'fcf_non_positive'));
  }
  const raw=input();Object.assign(raw.annuals[0],{operatingCashMinor:1000,capitalExpenditureMinor:2000,totalShares:100,fcfCoverageBps:20000});
  assert.ok(calculateDividendPricing(raw).blockers.includes('fcf_non_positive'));
  const earnings=input();earnings.annuals.slice(0,3).forEach(year=>{year.adjustedEpsMicros=-100;});
  assert.ok(calculateDividendPricing(earnings).blockers.includes('non_positive_earnings'));
  delete earnings.annuals[0].adjustedEpsMicros;
  assert.ok(calculateDividendPricing(earnings).blockers.includes('annual_eps_missing'));
});
test('synthetic Agricultural Bank case resolves auxiliary-anchor conflict without applying industrial FCF rules', () => {
  const v={...input(),code:'601288',name:'农业银行',financialSector:true,priceMinor:600,bvpsMicros:8000000,
    financialReview:{sector:'bank' as const,status:'pass' as const,asOf:'2026-06-30',metrics:[],missing:[],sourceUrl:'https://example.com/bank-review',policySourceUrls:[],basis:'dividend_screen' as const}};
  v.annuals.forEach(year=>Object.assign(year,{epsMicros:650000,adjustedEpsMicros:650000,payoutBps:3000,dividendMicros:195000,roeBps:1200,fcfCoverageBps:-5000}));
  v.history.samples.forEach(sample=>{sample.yieldBps=900;});v.opportunity.yieldBps=409;v.treasury.yieldBps=164;
  const p=calculateDividendPricing(v);
  assert.equal(p.riskClass,'bank');assert.equal(p.canApply,true);assert.deepEqual(p.blockers,[]);
  assert.equal(p.anchors.medianBps,409);assert.equal(p.anchors.selectedBps,900);assert.equal(p.anchorPriceMinor,216);
  assert.equal(p.theoreticalPriceMinor,216);assert.deepEqual(p.grid.map(g=>g.priceMinor),[205,183,162]);
  assert.equal(p.fcfDividendCapMicros,undefined);assert.equal(p.fcfCapApplied,false);assert.deepEqual(p.fcfEvidence,[]);
  assert.deepEqual(p.warnings,['anchors_conflict']);
  assert.ok(calculateDividendPricing({...v,financialReview:{...v.financialReview,status:'risk'}}).pauseReasons?.includes('financial_sector_review'));
});
test('cyclical normalisation remains an independent paused-buying review and future-dated evidence is not applied', () => {
  const v=input();v.method.stockOverrides[v.code]={riskClass:'cyclical'};v.method.riskPremiumBps.cyclical=300;
  assert.ok(calculateDividendPricing(v).pauseReasons?.includes('cyclical_normalisation_required'));
  Object.assign(v.method.stockOverrides[v.code],{normalizedEpsMicros:800000,normalizationSource:'Three reports adjusted for peak earnings',normalizationAsOf:asOf});
  assert.equal(calculateDividendPricing(v).d1Micros,400000);assert.equal(calculateDividendPricing(v).canApply,true);
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
test('historical yield uses only implemented cash before each sample and converts stock bonuses to the sample share basis', () => {
  const dist={success:true,result:{data:[
    {SECURITY_CODE:'600000',REPORT_DATE:'2022-12-31',EX_DIVIDEND_DATE:'2023-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:1,BONUS_RATIO:0,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2023-12-31',EX_DIVIDEND_DATE:'2024-06-01',ASSIGN_PROGRESS:'实施分配',PRETAX_BONUS_RMB:10,BONUS_RATIO:10,IT_RATIO:0},
    {SECURITY_CODE:'600000',REPORT_DATE:'2024-12-31',EX_DIVIDEND_DATE:'2025-06-01',ASSIGN_PROGRESS:'董事会预案',PRETAX_BONUS_RMB:100,BONUS_RATIO:0,IT_RATIO:0}]}};
  const h=dividendPricingYieldHistory([{date:'2024-07-01',priceMinor:1000}],dist,'600000');
  assert.equal(h!.samples[0].yieldBps,500);assert.equal(h!.capitalActionsVerified,true);
});
