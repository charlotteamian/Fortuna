import Dexie from 'dexie';
import type { Settings } from '../db.ts';
import { requestPortableSnapshot } from './portableSnapshotEvents.ts';
import { loadDividendLedgerForCheck } from './dividendLedgerEvidenceService.ts';
import { calculateDividendPricing, type DividendPricingMethod, type DividendPricingResult } from '../lib/dividendPricing.ts';
import { buildDividendManualBase, dividendAutomaticSignature, dividendManualFingerprint, type DividendManualInputs } from '../lib/dividendManualInputs.ts';
import { dateInChina } from '../lib/dividendWorkbench.ts';
import { evaluateDividendResearch } from '../lib/dividendResearch.ts';
import { dividendResearchSnapshotForStock, loadDividendResearchCache, saveDividendResearchCache } from './dividendResearchCacheService.ts';

const readDatabase = new Dexie('AssetManagerDB');
export async function loadDividendManualInputs(code: string) {
  try { await readDatabase.open(); return (await readDatabase.table<Settings>('settings').get('main'))?.dividendManualInputs?.[code]; }
  catch (cause) { if (cause instanceof Error && cause.name === 'NoSuchDatabaseError') return undefined; throw cause; }
}
export function closeDividendManualInputs() { readDatabase.close(); }

export function applyDividendManualInputs(pricing: DividendPricingResult, value: DividendManualInputs, stock: { code: string; name: string; financialSector?: boolean; sector?: string }, method: DividendPricingMethod, asOf: string): DividendPricingResult {
  if (value.code !== stock.code) throw new Error('DIVIDEND_MANUAL_INVALID');
  const base = buildDividendManualBase(value, asOf, pricing);
  const result = calculateDividendPricing({ ...stock, financialSector: stock.financialSector ?? false, method, asOf,
    dividendBase: base, annuals: pricing.annuals, priceMinor: pricing.currentPriceMinor, priceDate: pricing.priceDate,
    treasury: pricing.treasury, history: pricing.history, opportunity: pricing.opportunity, financialReview: pricing.financialReview,
    sourceUrls: [...pricing.sourceUrls, ...base.sourceUrls] });
  result.userConfirmedEvidence = { confirmedAt: value.confirmedAt, expiresOn: value.expiresOn,
    fingerprint: dividendManualFingerprint(value), automaticSignature: value.automaticSignature, automaticLedger: pricing.ledger ?? pricing.userConfirmedEvidence?.automaticLedger };
  return result;
}
/** User corrections are kept separately; automatic source evidence is never rewritten. */
export async function saveDividendManualInputs(value: DividendManualInputs) {
  const cache = await loadDividendResearchCache();
  const snapshot = cache ? dividendResearchSnapshotForStock(cache, value.code) : undefined;
  const stock = snapshot?.stocks[0], method = snapshot?.pricingMethod;
  if (!cache || !snapshot || !stock?.pricing || !method) throw new Error('DIVIDEND_MANUAL_CHANGED');
  const independentLedger = await loadDividendLedgerForCheck(value.code);
  if (independentLedger && value.automaticSignature !== dividendAutomaticSignature(independentLedger)
    || value.automaticSignature !== dividendAutomaticSignature(stock.pricing.ledger ?? stock.pricing.userConfirmedEvidence?.automaticLedger)) throw new Error('DIVIDEND_MANUAL_CHANGED');
  const pricing = applyDividendManualInputs(stock.pricing, value, { ...stock, financialSector: stock.financial?.financialSector, sector: stock.financial?.sector }, method, dateInChina());
  if (!pricing.canApply) throw new Error('DIVIDEND_MANUAL_INVALID');
  const updated = evaluateDividendResearch({ ...stock, pricing }, snapshot.principles);
  const next = { ...snapshot, generatedAt: Date.now(), stocks: [updated] };
  // Save the input before the research so preview validation can bind to it.
  const { db, initializeSettings } = await import('../db.ts');
  await initializeSettings();
  await db.transaction('rw', db.settings, async () => {
    const settings = await db.settings.get('main');
    if (!settings) throw new Error('DIVIDEND_MANUAL_CHANGED');
    await db.settings.put({ ...settings, dividendManualInputs: { ...settings.dividendManualInputs, [value.code]: structuredClone(value) } });
  });
  requestPortableSnapshot('dividend-manual-inputs');
  await saveDividendResearchCache({ ...cache, snapshot: next, stockContexts: undefined });
  return next;
}


/** Official complete evidence takes precedence; a saved correction cannot revive changed or expired inputs. */
export function reuseDividendManualInputs(pricing: DividendPricingResult, value: DividendManualInputs | undefined, stock: { code: string; name: string; financialSector?: boolean; sector?: string }, method: DividendPricingMethod, asOf: string): DividendPricingResult {
  if (pricing.canApply || !value || value.automaticSignature !== dividendAutomaticSignature(pricing.ledger)) return pricing;
  try { return applyDividendManualInputs(pricing, value, stock, method, asOf); } catch { return pricing; }
}
