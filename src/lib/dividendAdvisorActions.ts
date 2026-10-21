import { isDividendStock, mainlandCode, type DividendStock, type GridLevel } from './dividendWorkbench.ts';

export interface DividendPlanProposal {
  id: string;
  code: string;
  reason: string;
  buyLevels?: GridLevel[];
  sellLevels?: GridLevel[];
  buyPaused?: boolean;
}

/** Model output is a draft. Only these grid fields may cross into a confirmed write. */
export function isDividendPlanProposal(value: unknown): value is DividendPlanProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as DividendPlanProposal;
  if (typeof p.id !== 'string' || !p.id.trim() || p.id.length > 100 || typeof p.code !== 'string' || mainlandCode(p.code) !== p.code
    || typeof p.reason !== 'string' || !p.reason.trim() || p.reason.length > 2000
    || (p.buyPaused !== undefined && typeof p.buyPaused !== 'boolean') || (!p.buyLevels && !p.sellLevels && p.buyPaused === undefined)) return false;
  const stock: DividendStock = { code: p.code, name: 'Draft', group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0, lotSize: 100,
    buyLevels: p.buyLevels, sellLevels: p.sellLevels };
  for (const levels of [p.buyLevels, p.sellLevels]) {
    if (levels !== undefined && (!Array.isArray(levels) || levels.some(level => !level || typeof level !== 'object' || Array.isArray(level)))) return false;
    // Each ladder uses one price basis so every adjacent pair can be checked.
    if (levels?.some(level => level.priceMinor !== undefined) && levels.some(level => level.priceMinor === undefined)) return false;
  }
  if (!isDividendStock(stock)) return false;
  // Prices must move down along the buy ladder and up along the sell ladder.
  for (const [side, levels] of [['buy', p.buyLevels], ['sell', p.sellLevels]] as const) {
    if (!levels) continue;
    for (let i = 1; i < levels.length; i++) {
      const previous = levels[i - 1], current = levels[i];
      if (previous.priceMinor !== undefined && current.priceMinor !== undefined) {
        if (side === 'buy' ? current.priceMinor >= previous.priceMinor : current.priceMinor <= previous.priceMinor) return false;
      } else if (previous.priceMinor === undefined && current.priceMinor === undefined
        && (side === 'buy' ? current.yieldBps <= previous.yieldBps : current.yieldBps >= previous.yieldBps)) return false;
    }
  }
  if (p.buyLevels && p.sellLevels) {
    if (p.buyLevels.every(row => row.priceMinor !== undefined) && p.sellLevels.every(row => row.priceMinor !== undefined)
      && Math.max(...p.buyLevels.map(row => row.priceMinor!)) >= Math.min(...p.sellLevels.map(row => row.priceMinor!))) return false;
    if (p.buyLevels.every(row => row.priceMinor === undefined) && p.sellLevels.every(row => row.priceMinor === undefined)
      && Math.min(...p.buyLevels.map(row => row.yieldBps)) <= Math.max(...p.sellLevels.map(row => row.yieldBps))) return false;
  }
  return true;
}

export function parseDividendAdvisorActions(raw: string, allowedCodes: string[]) {
  const actions: DividendPlanProposal[] = [];
  const allowed = new Set(allowedCodes);
  const seen = new Set<string>();
  const answer = raw.replace(/```fortuna-actions\s*\n([\s\S]*?)```/g, (_block, json: string) => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed) || parsed.length > 10) return '';
      for (const value of parsed) {
        if (!isDividendPlanProposal(value) || !allowed.has(value.code) || seen.has(value.code)) continue;
        seen.add(value.code);
        // Rebuild explicitly: arbitrary model fields must never be persisted.
        const levels = (rows: GridLevel[]) => rows.map(row => ({ yieldBps: row.yieldBps, portionBps: row.portionBps,
          ...(row.priceMinor === undefined ? {} : { priceMinor: row.priceMinor }) }));
        actions.push({ id: value.id, code: value.code, reason: value.reason,
          ...(value.buyPaused === undefined ? {} : { buyPaused: value.buyPaused }),
          ...(value.buyLevels ? { buyLevels: levels(value.buyLevels) } : {}), ...(value.sellLevels ? { sellLevels: levels(value.sellLevels) } : {}) });
      }
    } catch { /* Invalid drafts are never actionable. The readable answer survives. */ }
    return '';
  }).trim();
  return { answer, actions };
}
