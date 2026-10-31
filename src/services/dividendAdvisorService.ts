import { Capacitor, CapacitorHttp } from '@capacitor/core';
import Dexie, { type Table } from 'dexie';
import { holdingRecognitionProviderBody } from '../lib/holdingRecognitionProviders.ts';
import { dividendAdvisorReadableSnapshot, dividendAdvisorSystemPrompt, type DividendAdvisorContext, type DividendAdvisorMessage } from '../lib/dividendAdvisor.ts';
import { validateHoldingRecognitionConfig, type HoldingRecognitionConfig } from './holdingRecognitionService.ts';
import { parseDividendAdvisorActions } from '../lib/dividendAdvisorActions.ts';
import { dividendPricingIssueText, humanizeDividendPricingIssues, type DividendPricingResult } from '../lib/dividendPricing.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../lib/dividendPricingPlan.ts';
import { dividendCheckSummaryText } from '../lib/dividendCheckExplanation.ts';
import { dividendCheckEn, dividendCheckZh } from '../i18n/dividendCheckTranslations.ts';
import { dividendAdvisorConcepts, dividendAdvisorConceptFallback, dividendAdvisorResumeGuide } from '../i18n/dividendAdvisorConceptTranslations.ts';

export type DividendAdvisorConfig = HoldingRecognitionConfig;
export class DividendAdvisorError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'DividendAdvisorError'; this.code = code; }
}
interface ConfigRecord extends DividendAdvisorConfig { id: 'main' }
const configDatabase = new Dexie('FortunaDividendAdvisorConfig');
configDatabase.version(1).stores({ config: 'id' });
const configTable: Table<ConfigRecord, string> = configDatabase.table('config');
export function validateDividendAdvisorConfig(config: DividendAdvisorConfig): DividendAdvisorConfig {
  try { return validateHoldingRecognitionConfig(config); }
  catch (cause) { throw new DividendAdvisorError(cause instanceof Error && cause.message.endsWith('_URL') ? 'URL' : 'CONFIG'); }
}
export async function loadDividendAdvisorConfig(): Promise<DividendAdvisorConfig | null> {
  try { const value = await configTable.get('main'); return value ? validateDividendAdvisorConfig(value) : null; }
  catch { throw new DividendAdvisorError('STORAGE'); }
}
export async function saveDividendAdvisorConfig(config: DividendAdvisorConfig) {
  const value = validateDividendAdvisorConfig(config);
  try { await configTable.put({ id: 'main', ...value }); }
  catch { throw new DividendAdvisorError('STORAGE'); }
}
export async function clearDividendAdvisorConfig() {
  try { await configTable.delete('main'); }
  catch { throw new DividendAdvisorError('STORAGE'); }
}

export interface DividendAdvisorRequest {
  url: string; headers: Record<string, string>; body: Record<string, unknown>; signal: AbortSignal; timeoutMs: number;
}
export type DividendAdvisorTransport = (request: DividendAdvisorRequest) => Promise<{ status: number; data: unknown }>;
const MAX_RESPONSE_LENGTH = 1_000_000;
const MAX_ANSWER_LENGTH = 30_000;
export const DIVIDEND_ADVISOR_TIMEOUT_MS = 90_000;

function endpoint(config: DividendAdvisorConfig): string {
  const url = new URL(config.baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (config.protocol === 'openai') url.pathname = /\/chat\/completions$/.test(path) ? path : `${path || '/v1'}/chat/completions`;
  else if (config.protocol === 'anthropic') url.pathname = /\/messages$/.test(path) ? path : `${path || '/v1'}/messages`;
  else if (/:generateContent$/.test(path)) url.pathname = path;
  else {
    const base = path || '/v1beta';
    url.pathname = `${base}${/\/models$/.test(base) ? '' : '/models'}/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
  }
  return url.toString();
}

async function defaultTransport(request: DividendAdvisorRequest) {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({ url: request.url, headers: request.headers, data: request.body,
      responseType: 'json', connectTimeout: 15_000, readTimeout: request.timeoutMs, disableRedirects: true });
    return { status: response.status, data: response.data };
  }
  const headers = { ...request.headers };
  if (headers['anthropic-version']) headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const response = await fetch(request.url, { method: 'POST', headers, body: JSON.stringify(request.body),
    signal: request.signal, credentials: 'omit', redirect: 'error' });
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
  return { status: response.status, data: await response.text() };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    const part = object(item);
    return part && part.thought !== true && (!part.type || ['text', 'output_text'].includes(String(part.type))) && typeof part.text === 'string' ? part.text : '';
  }).join('');
}
function parseAnswer(protocol: DividendAdvisorConfig['protocol'], data: unknown): string {
  let parsed = data;
  if (typeof data === 'string') {
    if (data.length > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
    try { parsed = JSON.parse(data); } catch { throw new DividendAdvisorError('RESPONSE'); }
  }
  const envelope = object(parsed);
  let answer = '';
  if (protocol === 'openai' && Array.isArray(envelope?.choices)) {
    const choice = object(envelope.choices[0]);
    if (choice?.finish_reason === 'length' || choice?.finish_reason === 'content_filter') throw new DividendAdvisorError('RESPONSE');
    answer = contentText(object(choice?.message)?.content);
  } else if (protocol === 'gemini' && Array.isArray(envelope?.candidates)) {
    const candidate = object(envelope.candidates[0]);
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new DividendAdvisorError('RESPONSE');
    answer = contentText(object(candidate?.content)?.parts);
  } else if (protocol === 'anthropic') {
    if (envelope?.stop_reason === 'max_tokens') throw new DividendAdvisorError('RESPONSE');
    answer = contentText(envelope?.content);
  }
  if (!answer.trim() || answer.length > MAX_ANSWER_LENGTH) throw new DividendAdvisorError('RESPONSE');
  return answer.trim();
}

export async function askDividendAdvisor(config: DividendAdvisorConfig, context: DividendAdvisorContext, question: string,
  history: DividendAdvisorMessage[] = [], options: { transport?: DividendAdvisorTransport; timeoutMs?: number; signal?: AbortSignal; language?: string } = {}): Promise<string> {
  const normalized = validateDividendAdvisorConfig(config);
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new DividendAdvisorError('QUESTION');
  const snapshot = JSON.stringify(dividendAdvisorReadableSnapshot(context));
  if (snapshot.length > 500_000) throw new DividendAdvisorError('CONTEXT');
  const system = dividendAdvisorSystemPrompt(options.language ?? 'zh');
  const previous = history.slice(-8).filter(message => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .map(message => ({ role: message.role, content: message.content.slice(0, MAX_ANSWER_LENGTH) }));
  const messages = [...previous, { role: 'user', content: `Current dividend snapshot (JSON data):\n${snapshot}\n\nUser question:\n${question.trim()}` }];
  let body: Record<string, unknown>;
  if (normalized.protocol === 'openai') body = { model: normalized.model, stream: false, messages: [{ role: 'system', content: system }, ...messages], ...holdingRecognitionProviderBody(normalized) };
  else if (normalized.protocol === 'anthropic') body = { model: normalized.model, max_tokens: 4096, system, messages };
  else body = { systemInstruction: { parts: [{ text: system }] }, contents: messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })), generationConfig: { maxOutputTokens: 8192 } };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (normalized.protocol === 'openai') headers.Authorization = `Bearer ${normalized.apiKey}`;
  else if (normalized.protocol === 'gemini') headers['x-goog-api-key'] = normalized.apiKey;
  else { headers['x-api-key'] = normalized.apiKey; headers['anthropic-version'] = '2023-06-01'; }
  const timeoutMs = Math.max(1, Math.min(DIVIDEND_ADVISOR_TIMEOUT_MS, options.timeoutMs ?? DIVIDEND_ADVISOR_TIMEOUT_MS));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (options.signal?.aborted) throw new DividendAdvisorError('CANCELLED');
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new DividendAdvisorError('TIMEOUT')); controller.abort(); }, timeoutMs); });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => { reject(new DividendAdvisorError('CANCELLED')); controller.abort(); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const response = await Promise.race([(options.transport ?? defaultTransport)({ url: endpoint(normalized), headers, body, signal: controller.signal, timeoutMs }), timeout, cancelled]);
    if (response.status === 401 || response.status === 403) throw new DividendAdvisorError('AUTH');
    if (response.status === 429) throw new DividendAdvisorError('RATE_LIMIT');
    if (response.status < 200 || response.status >= 300) throw new DividendAdvisorError('HTTP');
    return parseAnswer(normalized.protocol, response.data);
  } catch (cause) {
    if (cause instanceof DividendAdvisorError) throw cause;
    throw new DividendAdvisorError('NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}

/** A standalone concept uses a fixed method explanation, never provider prose.
 * Finite topic matching is not used to judge whether an operation is safe. All
 * operations, mixed requests and unknown topics remain owned by checks. */
function standaloneConceptExplanation(question: string, chinese: boolean): { answer: string } | undefined {
  const request = question.trim().replace(/[。！？?.!]+$/, '').trim();
  const match = /^(?:请问|请)?(?:能不能|能否|能|可以)?(?:帮我)?(?:什么是|如何理解|解释一下|解释下|解释|介绍一下|说明一下|说明|讲讲|说说)([^，,；;。！？?\n]{1,60})$/.exec(request)
    ?? /^([^，,；;。！？?\n]{1,60}?)(?:是什么意思|什么意思|的意思是什么|是什么|是啥)$/.exec(request)
    ?? /^(?:please |could you |can you )?(?:what is|what are|define|explain(?: the concept of| the formula for)?|describe)\s+([^,;.!?\n]{1,100})$/i.exec(request)
    ?? /^what does\s+([^,;.!?\n]{1,80})\s+mean$/i.exec(request);
  if (!match) return undefined;
  const topic = match[1].replace(/(?:吗|呢|呀)$/, '').replace(/(?:的)?(?:概念|原理|公式)$/, '')
    .replace(/\s+(?:in simple terms|in plain english|simply|briefly)$/i, '').replace(/^the\s+/i, '').trim().toLowerCase();
  if (/并|然后|顺便|以及|今天|今日|现在|\b(?:and|then|also|today|now|my|our|your)\b/i.test(topic)) return undefined;
  const concept = dividendAdvisorConcepts.find(item => item.aliases.includes(topic));
  return { answer: (concept ?? dividendAdvisorConceptFallback)[chinese ? 'zh' : 'en'] };
}

export async function askDividendAdvisorWithActions(...args: Parameters<typeof askDividendAdvisor>) {
  const raw = await askDividendAdvisor(...args);
  const context = args[1];
  const checkedPricingPlan = (code: string, pricing: DividendPricingResult | undefined) => {
    const check = context.stockPlan.stocks.find(stock => stock.code === code)?.checkSummary;
    if (check?.freshness.evidenceStatus && check.freshness.evidenceStatus !== 'current'
      || check?.grid.reasons.includes('pricing_basis_changed')
      || check?.grid.reasons.includes('tax_changed') && !check.currentPlan) return null;
    return pricing ? dividendPricingPlan(pricing) : null;
  };
  const result = parseDividendAdvisorActions(raw, context.stockPlan.stocks.map(stock => stock.code));
  const chinese = (args[4]?.language ?? 'zh').startsWith('zh');
  const question = args[2];
  const dictionary = chinese ? dividendCheckZh : dividendCheckEn;
  const resumeGuide = /恢复|\b(?:resume|restart|reactivate)\b/i.test(question) ? dividendAdvisorResumeGuide[chinese ? 'zh' : 'en'] : '';
  let pricingAnswer = '';
  const pricingReasons = new Map<string, string>();
  const explicitPause = /(?:暂停|停止|关闭)(?:现有|这只|该股|股票|计划|网格|的|全部|所有|新增|继续|\s)*(?:加仓|买入|买进)/.test(question)
    && !/(?:不要|别|不必|无需|不用)[^，。；！？\n]{0,8}(?:暂停|停止|关闭)/.test(question)
    || /\b(?:pause|stop|disable)\s+(?:additional\s+)?(?:buying|buys|additions)\b/i.test(question) && !/\b(?:do not|don't|no need to)\s+(?:pause|stop|disable)\b/i.test(question);
  // Numerical drafts must come from the verified method, never a model's guess.
  // Pausing is independent of valuation and remains available when inputs are missing.
  result.actions = result.actions.flatMap(draft => {
    // Only the user's explicit pause request can create a pause draft. Resume
    // choices go through the fresh review and its explicit confirmation.
    const { buyPaused, ...details } = draft;
    const action = { ...details, ...(buyPaused === true && explicitPause ? { buyPaused: true } : {}) };
    const pricing = context.research?.stocks.find(stock => stock.code === action.code)?.pricing;
    if (!action.buyLevels && !action.sellLevels) return action.buyPaused === undefined ? [] : [action];
    const plan = checkedPricingPlan(action.code, pricing);
    const matches = (side: 'buyLevels' | 'sellLevels') => !action[side] || !!plan && action[side].length === plan[side].length
      && action[side].every((level, index) => level.priceMinor === plan[side][index].priceMinor
        && level.yieldBps === plan[side][index].yieldBps && level.portionBps === plan[side][index].portionBps);
    const { buyLevels, sellLevels, ...pause } = action;
    // Every numerical replacement includes both verified sides, even if the
    // provider emits only buys. Never preserve an unrelated stale sell ladder.
    void buyLevels; void sellLevels;
    if (plan && matches('buyLevels') && matches('sellLevels')) return [{ ...pause, ...plan }];
    return pause.buyPaused === undefined ? [] : [pause];
  });
  // Explicit regeneration must not depend on whether the model emits a machine
  // draft. Use only the same deterministic ladder shown in the research card.
  const negated = /(?:不要|别|无需|不用|不必|暂不|先不|不想|不需要)[^，。；！？\n]{0,8}(?:生成|重做|重建|重设|更新|调整|修正|修改|定价|计算|估算|给出|给个|提供)/.test(question)
    || /(?:do not|don't|no need to|without)\s+(?:regenerat|generat|rebuild|revis|adjust|replac|calculat|estimat)/i.test(question);
  if (negated) result.actions = result.actions.flatMap(({ buyLevels, sellLevels, ...action }) => {
    void buyLevels; void sellLevels;
    return action.buyPaused === undefined ? [] : [action];
  });
  const regenerate = !negated && (/(?:生成|重做|重建|重设|更新|调整|修正|修改|重新评估|重新定价|估算|计算|给出|给个|提供)/.test(question) && /(?:网格|计划|买价|买入价|锚点|估值|定价|价格)/.test(question)
    || /(?:regenerat|generat|rebuild|revis|adjust|replac|new|calculat|estimat)[\s\S]{0,60}(?:grid|plan|buy price|valuation|price)/i.test(question));
  if (context.activeStrategy === 'stocks' && regenerate) {
    const aliases: Record<string, string[]> = { '601288': ['农行'], '601398': ['工行'], '601939': ['建行'], '601988': ['中行'], '601328': ['交行'], '600036': ['招行'], '601658': ['邮储'] };
    const named = context.stockPlan.stocks.filter(stock => [stock.code, stock.name,
      stock.name.replace(/集团|股份|有限公司/g, '').trim(), ...aliases[stock.code] ?? []]
      .some(name => name.length >= 2 && question.toLowerCase().includes(name.toLowerCase())));
    const general = /所有|全部|各只|整个组合|all (?:stock|grid|plan)/i.test(question)
      || /^(?:请|帮我|麻烦|能否|可以|我要|我想|再|重新|生成|新建|调整|更新|重做|估算|计算|给出|给个|提供|一下|一个|新的|当前|我的|现有|的|网格|计划|买价|买入价|锚点|价格|估值|定价|方案|[。！？\s])+$/.test(question);
    const scope = named.length ? named : general ? context.stockPlan.stocks : [];
    const summaries: string[] = [];
    for (const saved of scope.slice(0, 10)) {
      const pricing = context.research?.stocks.find(stock => stock.code === saved.code)?.pricing;
      const plan = checkedPricingPlan(saved.code, pricing);
      if (!pricing || !plan) {
        const gaps = pricing?.blockers.map(issue => dividendPricingIssueText(issue, chinese ? 'zh' : 'en')) ?? [];
        summaries.push(chinese ? `${saved.name}：${gaps.length ? gaps.join('；') : '尚无完整定价数据，请先完成该股票研究'}。补齐后才能生成经典股息率网格，已有计划保留。`
          : `${saved.name}: ${gaps.length ? gaps.join('; ') : 'complete pricing evidence has not been collected'}. Complete these inputs before calculating the classic cash-yield grid; the saved plan is preserved.`);
        continue;
      }
      const money = (value: number) => (value / 100).toFixed(2);
      const pauseDetails = (pricing.pauseReasons ?? []).map(issue => dividendPricingIssueText(issue, chinese ? 'zh' : 'en')).join(chinese ? '；' : '; ');
      const reason = chinese
        ? `以最近已核验批次分红按固定股息率重算四档买入、四档卖出，每档25%；5%股息率中性参考线${money(pricing.theoreticalPriceMinor!)}元。保留当前手动暂停设置，仓位按价格档位、预算与持仓判断。风险提示：${pauseDetails || '本次无额外定价提示'}。`
        : `Rebuild four buy and four sell levels from verified recent-batch cash dividends and fixed cash yields, 25% each. The 5% neutral reference is CNY ${money(pricing.theoreticalPriceMinor!)}. Preserve the manual pause setting; actions depend on price levels, budget and holdings. Alerts: ${pauseDetails || 'no additional pricing alerts'}.`;
      pricingReasons.set(saved.code, reason.slice(0, 2000));
      result.actions = result.actions.filter(action => action.code !== saved.code);
      result.actions.push({ id: `reprice-${saved.code}`, code: saved.code, reason: reason.slice(0, 2000),
        ...(explicitPause ? { buyPaused: true } : {}),
        ...plan });
      const dividend = ((pricing.d1Micros ?? 0) / 1e6).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      const window = pricing.dividendBase?.reportPeriods.join('／') ?? '';
      summaries.push(chinese ? `${saved.name}：最近已核验批次分红${dividend}元/股${pricing.taxBps ? '（按所选持有期扣税后）' : '（税前；所选持有期税率0%）'}，所属期${window}。按固定股息率计算，买入四档${plan.buyLevels.map(level => money(level.priceMinor!)).join('／')}元；卖出四档${plan.sellLevels.map(level => money(level.priceMinor!)).join('／')}元，每档25%。5%股息率中性参考线${money(pricing.theoreticalPriceMinor!)}元，是纪律参考，不是公允价值。预览确认后同时替换两侧，保留当前手动暂停设置。风险提示：${pauseDetails || '本次无额外定价提示'}；仓位仍按价格档位、预算和持仓判断。`
        : `${saved.name}: verified recent-batch cash dividend CNY ${dividend} per share (${pricing.taxBps ? 'after the selected holding-period tax' : 'pretax; selected tax rate 0%'}), window ${window}. Fixed-yield buy levels ${plan.buyLevels.map(level => money(level.priceMinor!)).join(' / ')}; sell levels ${plan.sellLevels.map(level => money(level.priceMinor!)).join(' / ')}, 25% each. The 5% neutral reference is CNY ${money(pricing.theoreticalPriceMinor!)}; this is a discipline reference, not fair value. Preview and confirm to replace both sides while preserving the manual pause setting. Alerts: ${pauseDetails || 'no additional pricing alerts'}. Actions depend on price levels, budget and holdings.`);
    }
    // For explicit repricing, the deterministic result owns both prices and
    // readiness. Do not append a contradictory model refusal or another price.
    if (summaries.length) pricingAnswer = summaries.join('\n\n');
  }
  // Show accelerating declines as context without inventing pause actions.
  let technicalNotice = '';
  if (context.activeStrategy === 'stocks') {
    const dateCutoff = new Date(Date.parse(context.generatedAt) - 10 * 86400_000).toISOString().slice(0, 10);
    const accelerating = context.research?.stocks.filter(stock => stock.technical?.state === 'accelerating_down'
      && stock.technical.currentUsable && stock.technical.asOf >= dateCutoff && context.stockPlan.stocks.some(saved => saved.code === stock.code && !saved.buyPaused)) ?? [];
    if (accelerating.length) { technicalNotice = chinese
      ? `风险提示：${accelerating.map(stock => stock.name).join('、')}的已获取日线显示下跌加速，短期波动风险较高；不自动暂停，仍按价格档位、预算和持仓自主决定。`
      : `Risk alert: the downloaded daily data for ${accelerating.map(stock => stock.name).join(', ')} show an accelerating decline and higher short-term volatility. This does not pause the grid; decide using price levels, budget and holdings.`;
    }
  }
  result.actions = result.actions.slice(0, 10).map(action => {
    const pricing = context.research?.stocks.find(stock => stock.code === action.code)?.pricing;
    const gridProvenance = pricing && (action.buyLevels || action.sellLevels) ? dividendPricingProvenance(pricing, context.research!.generatedAt) : undefined;
    // A preview's reason is visible too. Never retain a provider's action
    // conclusion here after replacing the main answer.
    const reason = action.buyLevels || action.sellLevels ? pricingReasons.get(action.code) ?? dictionary.div_check_help_grid : dictionary.div_check_pause_draft;
    return { ...action, ...(gridProvenance ? { gridProvenance } : {}), reason };
  });
  const allChecks = [...context.stockPlan.stocks.map(stock => stock.checkSummary), ...context.fundPlan.funds.map(fund => fund.checkSummary)];
  const namedChecks = allChecks.filter(check => question.includes(check.name) || !!check.code && question.includes(check.code));
  const scope = namedChecks.length ? namedChecks : /股票.*基金|stocks.*funds|全部|所有|both|all/i.test(question) ? allChecks
    : context.activeStrategy === 'stocks' ? context.stockPlan.stocks.map(stock => stock.checkSummary) : context.fundPlan.funds.map(fund => fund.checkSummary);
  // Intent never grants provider prose an exception. Only an actually rebuilt
  // pricing answer owns the preview channel; operation status always comes from
  // the same summary, even for a mixed repricing question or an unmatched target.
  const explanation = !pricingAnswer && !result.actions.length ? standaloneConceptExplanation(question, chinese) : undefined;
  if (explanation) result.answer = explanation.answer;
  if (!explanation) {
    result.answer = [result.actions.some(action => action.buyPaused === true) ? dictionary.div_check_pause_draft : '',
      resumeGuide, technicalNotice, pricingAnswer, dictionary.div_check_ai_limited, dividendCheckSummaryText(scope, chinese ? 'zh' : 'en')]
      .filter(Boolean).join('\n\n');
  }
  result.answer = humanizeDividendPricingIssues(result.answer, chinese ? 'zh' : 'en');
  return result;
}
