import { readFileSync } from 'node:fs';
import { buildDividendLedger, parseDividendOfficialAnnouncementText, type DividendLedgerBase } from '../../src/lib/dividendLedger.ts';

/** Controlled arithmetic fixture: explicitly verified recent-batch inputs, never a provider-derived TTM shortcut. */
export function verifiedDividendBase(dpsMicros = 500000, asOf = '2026-10-21', patch: Partial<DividendLedgerBase> = {}): DividendLedgerBase {
  return { dpsMicros, asOf, frequency: 'annual', requiredBatches: 1, selectedBatchIds: ['synthetic-verified-annual-batch'],
    latestExDate: `${asOf.slice(0, 4)}-01-01`, verified: true, flags: [], reportPeriods: [`${Number(asOf.slice(0, 4)) - 1}-12-31`],
    sourceUrls: ['https://example.com/synthetic-verified-distribution'], ...patch };
}

export function pingAnOfficialLedger(asOf = '2026-10-23') {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
  const officialEvents = ['pingan-2025-final', 'pingan-2026-interim'].map(name => {
    const raw = JSON.parse(readFileSync(new URL(`../fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8'));
    const parsed = parseDividendOfficialAnnouncementText(raw.text, raw);
    if (!parsed) throw new Error(`INVALID_OFFICIAL_FIXTURE:${name}`);
    return parsed;
  });
  return buildDividendLedger(fixture.sources.distribution.data, '000001', asOf, { officialEvents });
}
