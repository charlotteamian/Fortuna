import type { DividendCheckSummary } from './dividendCheckSummary.ts';
import { invalidateOutdatedDividendPricing, type DividendPricingResult } from './dividendPricing.ts';
import { dividendPricingPlan } from './dividendPricingPlan.ts';

export type DividendPricingGapKind = 'conflict' | 'crosscheck' | 'frequency' | 'cash' | 'calculation' | 'other';
export interface DividendPricingGuide {
  status: 'ready' | 'conflict' | 'waiting';
  grossDpsMicros?: number;
  netDpsMicros?: number;
  taxBps: number;
  periods: string[];
  requiredBatches?: number;
  frequency: 'annual' | 'semiannual' | 'unknown';
  exampleBuyPriceMinor?: number;
  exampleBuyYieldBps?: number;
  gaps: { kind: DividendPricingGapKind; reasons: string[] }[];
  advisoryCount: number;
  sourceCount: number;
}

const kindFor = (reason: string): DividendPricingGapKind => reason.includes('source_conflict') ? 'conflict'
  : reason.includes('crosscheck_mismatch') ? 'crosscheck'
    : reason.includes('frequency_unknown') ? 'frequency'
      : /dividend|ledger|trailing|cash_distributions/.test(reason) ? 'cash'
        : reason === 'pricing_calculation_stale' ? 'calculation' : 'other';

/** Explains the existing deterministic calculation; it never approves evidence
 * or changes eligibility, saved prices, financial rules or action conditions. */
export function dividendPricingGuide(source: DividendPricingResult, check?: DividendCheckSummary): DividendPricingGuide {
  const pricing = invalidateOutdatedDividendPricing(source);
  const calculatedPlan = dividendPricingPlan(pricing);
  const currentEvidenceChanged = !!calculatedPlan && check?.kind === 'stock' && !check.currentPlan;
  const plan = currentEvidenceChanged ? null : calculatedPlan;
  const grouped = new Map<DividendPricingGapKind, string[]>();
  for (const reason of new Set([...pricing.blockers, ...currentEvidenceChanged ? ['dividend_base_unverified'] : []])) {
    const kind = kindFor(reason), reasons = grouped.get(kind) ?? [];
    reasons.push(reason); grouped.set(kind, reasons);
  }
  const priority: DividendPricingGapKind[] = ['conflict', 'crosscheck', 'frequency', 'cash', 'calculation', 'other'];
  const base = pricing.dividendBase;
  const verifiedBase = !currentEvidenceChanged && base?.verified && Number.isSafeInteger(base.dpsMicros) && base.dpsMicros! >= 0;
  const advisoryReasons = check ? [...check.risk.attention, ...check.risk.evidenceInsufficient]
    .filter(item => item.impact !== 'new_price' && !pricing.blockers.includes(item.reason as typeof pricing.blockers[number]))
    .map(item => item.reason) : [...pricing.warnings, ...pricing.pauseReasons ?? []];
  return {
    status: plan ? 'ready' : grouped.has('conflict') || grouped.has('crosscheck') ? 'conflict' : 'waiting',
    grossDpsMicros: verifiedBase ? base!.dpsMicros : undefined,
    netDpsMicros: plan ? pricing.d1Micros : undefined,
    taxBps: pricing.taxBps,
    periods: [...new Set(base?.reportPeriods ?? [])],
    requiredBatches: base?.requiredBatches,
    frequency: base?.frequency ?? 'unknown',
    exampleBuyPriceMinor: plan?.buyLevels[0]?.priceMinor,
    exampleBuyYieldBps: plan?.buyLevels[0]?.yieldBps,
    gaps: priority.flatMap(kind => grouped.has(kind) ? [{ kind, reasons: grouped.get(kind)! }] : []),
    advisoryCount: new Set(advisoryReasons).size,
    sourceCount: new Set(base?.sourceUrls ?? []).size,
  };
}
