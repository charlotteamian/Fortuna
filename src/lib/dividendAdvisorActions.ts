import { isDividendStock, mainlandCode, type DividendStock, type GridLevel } from './dividendWorkbench.ts';
import { isDividendGridProvenance, type DividendGridProvenance } from './dividendGridProvenance.ts';

export interface DividendPlanProposal {
  id: string;
  code: string;
  reason: string;
  buyLevels?: GridLevel[];
  sellLevels?: GridLevel[];
  buyPaused?: boolean;
  gridProvenance?: DividendGridProvenance;
}

/** Model output is a draft. Only these grid fields may cross into a confirmed write. */
export function isDividendPlanProposal(value: unknown): value is DividendPlanProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as DividendPlanProposal;
  if (typeof p.id !== 'string' || !p.id.trim() || p.id.length > 100 || typeof p.code !== 'string' || mainlandCode(p.code) !== p.code
    || typeof p.reason !== 'string' || !p.reason.trim() || p.reason.length > 2000
    || (p.buyPaused !== undefined && typeof p.buyPaused !== 'boolean') || (!p.buyLevels && !p.sellLevels && p.buyPaused === undefined)) return false;
  if (p.gridProvenance !== undefined && (!isDividendGridProvenance(p.gridProvenance) || !p.buyLevels || !p.sellLevels)) return false;
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
  const consume = (json: string, explicit = false): boolean => {
    try {
      const parsed: unknown = JSON.parse(json);
      // Alternate provider formatting is accepted only for a recognisable plan
      // payload. Ordinary JSON examples and quoted code remain readable.
      if (!Array.isArray(parsed) || (!explicit && (!parsed.length || !parsed.every(value => value && typeof value === 'object'
        && !Array.isArray(value) && 'id' in value && 'code' in value && 'reason' in value
        && ('buyPaused' in value || 'buyLevels' in value || 'sellLevels' in value))))) return explicit;
      if (parsed.length > 10) return true;
      for (const value of parsed) {
        if (actions.length >= 10 || !isDividendPlanProposal(value) || !allowed.has(value.code) || seen.has(value.code)) continue;
        seen.add(value.code);
        // Rebuild explicitly: arbitrary model fields must never be persisted.
        const levels = (rows: GridLevel[]) => rows.map(row => ({ yieldBps: row.yieldBps, portionBps: row.portionBps,
          ...(row.priceMinor === undefined ? {} : { priceMinor: row.priceMinor }) }));
        actions.push({ id: value.id, code: value.code, reason: value.reason,
          ...(value.buyPaused === undefined ? {} : { buyPaused: value.buyPaused }),
          ...(value.buyLevels ? { buyLevels: levels(value.buyLevels) } : {}), ...(value.sellLevels ? { sellLevels: levels(value.sellLevels) } : {}) });
      }
      return true;
    } catch { /* Invalid drafts are never actionable. The readable answer survives. */ }
    return explicit;
  };
  const plainText = (text: string) => {
    let answer = '', cursor = 0, start = -1, depth = 0, quoted = false, escaped = false;
    // Balance arrays while respecting JSON strings; a greedy expression would
    // swallow prose between drafts or stop inside a nested grid/string.
    for (let end = 0; end < text.length; end++) {
      const char = text[end];
      if (start < 0) {
        if (char === '[') { start = end; depth = 1; }
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) {
        if (consume(text.slice(start, end + 1))) {
          answer += text.slice(cursor, start); cursor = end + 1;
        }
        start = -1;
      }
    }
    return answer + text.slice(cursor);
  };
  let answer = '', cursor = 0;
  // Process every fence so bare-JSON recovery never interprets examples inside
  // an unrelated code block. Accept CRLF, capitalised labels and tilde fences.
  const fences = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)^ {0,3}\1[ \t]*\r?$/gm;
  for (const match of raw.matchAll(fences)) {
    answer += plainText(raw.slice(cursor, match.index));
    const label = match[2].trim().toLowerCase();
    if (!['fortuna-actions', 'json', ''].includes(label) || !consume(match[3], label === 'fortuna-actions')) answer += match[0];
    cursor = match.index + match[0].length;
  }
  answer = (answer + plainText(raw.slice(cursor))).trim();
  return { answer, actions };
}
