import { Capacitor, CapacitorHttp } from '@capacitor/core';
import Dexie, { type Table } from 'dexie';
import { holdingRecognitionProviderBody } from '../lib/holdingRecognitionProviders.ts';
import { dividendAdvisorReadableSnapshot, dividendAdvisorSystemPrompt, type DividendAdvisorContext, type DividendAdvisorMessage } from '../lib/dividendAdvisor.ts';
import { validateHoldingRecognitionConfig, type HoldingRecognitionConfig } from './holdingRecognitionService.ts';
import { hasEffectiveGridPlanChange, parseDividendAdvisorActions, type DividendPlanProposal } from '../lib/dividendAdvisorActions.ts';
import { dividendPricingIssueText, humanizeDividendPricingIssues, type DividendPricingResult } from '../lib/dividendPricing.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../lib/dividendPricingPlan.ts';
import { dividendCheckSummaryText } from '../lib/dividendCheckExplanation.ts';
import { dividendCheckEn, dividendCheckZh } from '../i18n/dividendCheckTranslations.ts';
import { dividendAdvisorConcepts, dividendAdvisorResumeGuide } from '../i18n/dividendAdvisorConceptTranslations.ts';
import { renderDividendExplanation } from '../lib/dividendAdvisorExplanation.ts';
import { dividendAdvisorFailureCopy, dividendExplanationUi } from '../i18n/dividendAdvisorExplanationTranslations.ts';
import type { DividendResearchSnapshot } from '../lib/dividendResearch.ts';

export type DividendAdvisorConfig = HoldingRecognitionConfig;
export class DividendAdvisorError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly detail?: string;
  constructor(code: string, options?: { httpStatus?: number; detail?: string }) {
    super(code);
    this.name = 'DividendAdvisorError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.detail = options?.detail;
  }
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
export const DIVIDEND_ADVISOR_TIMEOUT_MS = 180_000;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const MAX_REDIRECT_HOPS = 2;
const SNAPSHOT_TRIM_THRESHOLD = 35_000;

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

function isOpenAiChatCompletionsUrl(rawUrl: string): boolean {
  try { return new URL(rawUrl).pathname.replace(/\/+$/, '').endsWith('/chat/completions'); }
  catch { return false; }
}

function findHeaderIgnoreCase(headers: Record<string, unknown> | undefined, target: string): string | undefined {
  if (!headers) return undefined;
  const lower = target.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') return value;
  }
  return undefined;
}

function resolveSameOriginHttpsRedirect(currentUrl: string, location: string | undefined): string | null {
  if (!location) return null;
  try {
    const current = new URL(currentUrl);
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || next.origin !== current.origin) return null;
    if (next.username || next.password) return null;
    return next.toString();
  } catch { return null; }
}

async function sendHttpPost(initialUrl: string, headers: Record<string, string>, body: Record<string, unknown>,
  signal: AbortSignal, timeoutMs: number): Promise<{ status: number; data: unknown }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (signal.aborted) throw new DividendAdvisorError('CANCELLED');
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.post({
        url: currentUrl, headers, data: body, responseType: 'text',
        connectTimeout: Math.min(20_000, timeoutMs),
        readTimeout: Math.min(timeoutMs + 5_000, 185_000),
        disableRedirects: true,
      });
      if (REDIRECT_STATUSES.has(response.status) && hop < MAX_REDIRECT_HOPS) {
        const location = findHeaderIgnoreCase(object(response.headers) ?? undefined, 'location');
        const nextUrl = resolveSameOriginHttpsRedirect(currentUrl, location);
        if (nextUrl) { currentUrl = nextUrl; continue; }
      }
      if (typeof response.data === 'string' && response.data.length > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
      return { status: response.status, data: response.data };
    }
    const fetchHeaders = { ...headers };
    if (fetchHeaders['anthropic-version']) fetchHeaders['anthropic-dangerous-direct-browser-access'] = 'true';
    const response = await fetch(currentUrl, {
      method: 'POST', headers: fetchHeaders, body: JSON.stringify(body),
      signal, credentials: 'omit', redirect: 'manual',
    });
    if (response.type === 'opaqueredirect' || response.status === 0) throw new DividendAdvisorError('NETWORK');
    if (REDIRECT_STATUSES.has(response.status) && hop < MAX_REDIRECT_HOPS) {
      const nextUrl = resolveSameOriginHttpsRedirect(currentUrl, response.headers.get('location') ?? undefined);
      if (nextUrl) { currentUrl = nextUrl; continue; }
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
    const text = await response.text();
    if (text.length > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
    return { status: response.status, data: text };
  }
  throw new DividendAdvisorError('NETWORK');
}

async function defaultTransport(request: DividendAdvisorRequest) {
  if (isOpenAiChatCompletionsUrl(request.url) && request.body.stream === false) {
    const streamResponse = await sendHttpPost(
      request.url,
      { ...request.headers, Accept: 'text/event-stream, application/json' },
      { ...request.body, stream: true },
      request.signal,
      request.timeoutMs,
    );
    if (streamResponse.status === 400 || streamResponse.status === 405 || streamResponse.status === 422) {
      return sendHttpPost(request.url, request.headers, request.body, request.signal, request.timeoutMs);
    }
    return streamResponse;
  }
  return sendHttpPost(request.url, request.headers, request.body, request.signal, request.timeoutMs);
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

/** Extract only short, structured JSON error metadata, never raw provider bodies or secrets. */
function extractSafeProviderErrorDetail(data: unknown, apiKey: string): string | undefined {
  let parsed = data;
  if (typeof data === 'string') {
    if (data.length > 64_000) return undefined;
    try { parsed = JSON.parse(data); } catch { return undefined; }
  }
  const envelope = object(parsed);
  if (!envelope) return undefined;
  const errObj = object(envelope.error);
  const rawCode = typeof errObj?.code === 'string' ? errObj.code
    : typeof errObj?.type === 'string' ? errObj.type
    : typeof errObj?.status === 'string' ? errObj.status
    : typeof envelope.code === 'string' ? envelope.code : '';
  const rawMessage = typeof errObj?.message === 'string' ? errObj.message
    : typeof envelope.message === 'string' ? envelope.message : '';
  const combined = [rawCode, rawMessage].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim();
  if (!combined || (apiKey && combined.includes(apiKey))) return undefined;
  const scrubbed = combined.replace(/sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/gi, '[redacted]').slice(0, 140).trim();
  return scrubbed || undefined;
}

/** Classify raw transport errors into safe codes without ever exposing raw messages or API keys. */
export function classifyTransportError(cause: unknown, signalAborted = false): DividendAdvisorError {
  if (cause instanceof DividendAdvisorError) return cause;
  const parts: string[] = [];
  const names: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null && !visited.has(current); depth++) {
    visited.add(current);
    if (typeof current === 'string') { parts.push(current); break; }
    const errObj = object(current);
    const name = current instanceof Error ? current.name : typeof errObj?.name === 'string' ? errObj.name : '';
    const message = current instanceof Error ? current.message
      : typeof errObj?.message === 'string' ? errObj.message
      : typeof errObj?.errorMessage === 'string' ? errObj.errorMessage : '';
    const errCode = typeof errObj?.code === 'string' ? errObj.code : '';
    if (name) names.push(name);
    if (name || errCode || message) parts.push(`${name} ${errCode} ${message}`);
    current = current instanceof Error ? current.cause : errObj?.cause;
  }
  const combined = parts.join(' ');
  if (signalAborted && names.some(name => name === 'AbortError' || /abort/i.test(name))) {
    return new DividendAdvisorError('CANCELLED');
  }
  if (names.includes('TimeoutError') || /sockettimeout|timed?\s*out|etimedout/i.test(combined)) {
    return new DividendAdvisorError('TIMEOUT');
  }
  if (/ssl|cert|handshake|pkix/i.test(combined)) {
    return new DividendAdvisorError('NETWORK', { detail: 'tls' });
  }
  if (/unknownhost|enotfound|gai_error|name or service not known/i.test(combined)) {
    return new DividendAdvisorError('NETWORK', { detail: 'dns' });
  }
  if (/eofexception|unexpected end of stream|connection reset|econnreset|socket closed|broken pipe/i.test(combined)) {
    return new DividendAdvisorError('NETWORK', { detail: 'reset' });
  }
  return new DividendAdvisorError('NETWORK');
}

export function formatDividendAdvisorFailure(cause: unknown, language = 'zh'): string {
  const copy = dividendAdvisorFailureCopy[language.startsWith('zh') ? 'zh' : 'en'];
  const err = cause instanceof DividendAdvisorError ? cause : new DividendAdvisorError('NETWORK');
  const statusText = err.httpStatus ? ` HTTP ${err.httpStatus}` : '';
  const detailText = err.detail && !['truncated', 'content_filter', 'empty', 'invalid_json', 'tls', 'dns', 'reset'].includes(err.detail)
    ? copy.detailPrefix.replace('{{detail}}', err.detail) : '';
  const fill = (template: string) => template.replace('{{status}}', statusText).replace('{{detail}}', detailText).trim();
  switch (err.code) {
    case 'CONFIG': return copy.unconfigured;
    case 'URL': return copy.url;
    case 'CONTEXT': return copy.context;
    case 'AUTH': return fill(copy.auth);
    case 'RATE_LIMIT': return fill(copy.rateLimit);
    case 'HTTP': return fill(copy.http);
    case 'TIMEOUT': return copy.timeout;
    case 'RESPONSE':
      if (err.detail === 'truncated') return copy.responseTruncated;
      if (err.detail === 'content_filter') return copy.responseFiltered;
      return copy.response;
    default:
      if (err.detail === 'tls') return copy.networkTls;
      if (err.detail === 'dns') return copy.networkDns;
      if (err.detail === 'reset') return copy.networkReset;
      return copy.network;
  }
}

function parseOpenAiSseAnswer(raw: string, apiKey: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed.startsWith('data:') && !normalized.includes('\ndata:')) {
    throw new DividendAdvisorError('RESPONSE', { detail: 'invalid_json' });
  }
  let answer = '';
  let finishReason: string | undefined;
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let chunk: Record<string, unknown> | null;
    try { chunk = object(JSON.parse(payload)); }
    catch { throw new DividendAdvisorError('RESPONSE', { detail: 'invalid_json' }); }
    if (!chunk) continue;
    if (chunk.error) throw new DividendAdvisorError('HTTP', { detail: extractSafeProviderErrorDetail(chunk, apiKey) });
    const choice = Array.isArray(chunk.choices) ? object(chunk.choices[0]) : null;
    if (!choice) continue;
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
    const delta = object(choice.delta);
    if (delta && delta.thought !== true) answer += contentText(delta.content);
  }
  if (finishReason === 'length') throw new DividendAdvisorError('RESPONSE', { detail: 'truncated' });
  if (finishReason === 'content_filter') throw new DividendAdvisorError('RESPONSE', { detail: 'content_filter' });
  if (!answer.trim() || answer.length > MAX_ANSWER_LENGTH) throw new DividendAdvisorError('RESPONSE', { detail: 'empty' });
  return answer.trim();
}

function parseAnswer(protocol: DividendAdvisorConfig['protocol'], data: unknown, apiKey = ''): string {
  let parsed = data;
  if (typeof data === 'string') {
    if (data.length > MAX_RESPONSE_LENGTH) throw new DividendAdvisorError('RESPONSE');
    try { parsed = JSON.parse(data); }
    catch {
      if (protocol === 'openai') return parseOpenAiSseAnswer(data, apiKey);
      throw new DividendAdvisorError('RESPONSE', { detail: 'invalid_json' });
    }
  }
  const envelope = object(parsed);
  let answer = '';
  if (protocol === 'openai' && Array.isArray(envelope?.choices)) {
    const choice = object(envelope.choices[0]);
    if (choice?.finish_reason === 'length') throw new DividendAdvisorError('RESPONSE', { detail: 'truncated' });
    if (choice?.finish_reason === 'content_filter') throw new DividendAdvisorError('RESPONSE', { detail: 'content_filter' });
    answer = contentText(object(choice?.message)?.content);
  } else if (protocol === 'gemini' && Array.isArray(envelope?.candidates)) {
    const candidate = object(envelope.candidates[0]);
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      const detail = candidate.finishReason === 'MAX_TOKENS' ? 'truncated'
        : ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(String(candidate.finishReason)) ? 'content_filter' : undefined;
      throw new DividendAdvisorError('RESPONSE', detail ? { detail } : undefined);
    }
    answer = contentText(object(candidate?.content)?.parts);
  } else if (protocol === 'anthropic') {
    if (envelope?.stop_reason === 'max_tokens') throw new DividendAdvisorError('RESPONSE', { detail: 'truncated' });
    answer = contentText(envelope?.content);
  }
  if (!answer.trim() || answer.length > MAX_ANSWER_LENGTH) throw new DividendAdvisorError('RESPONSE', { detail: 'empty' });
  return answer.trim();
}

function buildSnapshotPayload(context: DividendAdvisorContext, question: string, explanationResearch?: DividendResearchSnapshot): string {
  const readable = dividendAdvisorReadableSnapshot(context, explanationResearch);
  const raw = JSON.stringify(readable);
  if (raw.length <= SNAPSHOT_TRIM_THRESHOLD) return raw;
  const trimmed = structuredClone(readable) as Record<string, unknown>;
  const trimShares = (plan: unknown) => {
    const planObj = object(plan);
    if (!planObj || !Array.isArray(planObj['Shares'])) return;
    for (const item of planObj['Shares']) {
      const stockObj = object(item);
      if (!stockObj) continue;
      const dists = stockObj['Implemented cash distributions'];
      if (Array.isArray(dists) && dists.length > 8) {
        stockObj['Implemented cash distributions'] = [...dists]
          .sort((a, b) => String(object(b)?.['Ex-dividend date'] ?? '').localeCompare(String(object(a)?.['Ex-dividend date'] ?? '')))
          .slice(0, 8);
      }
    }
  };
  trimShares(trimmed['Active plan to discuss first']);
  if (context.activeStrategy === 'stocks' && !/基金|fund|对比|比较|both|all|全部/i.test(question)) {
    trimmed['Alternative saved plan, discuss only when the user asks about it'] = {
      Strategy: 'Dividend funds',
      Note: 'Omitted unless asked',
    };
  } else {
    trimShares(trimmed['Alternative saved plan, discuss only when the user asks about it']);
  }
  return JSON.stringify(trimmed);
}

export interface DividendAdvisorOptions {
  transport?: DividendAdvisorTransport; timeoutMs?: number; signal?: AbortSignal; language?: string;
  /** Internal explanation protocol, separate from the legacy low-level provider API. */
  systemPrompt?: string;
  /** Existing dated research being discussed, never an input to an action. */
  explanationResearch?: DividendResearchSnapshot;
  /** Optional concise deterministic status appended alongside the snapshot, not subject to the user question limit. */
  extraContext?: string;
  /** When false, no portfolio snapshot (budget, holdings, personal notes) is sent. */
  includeSnapshot?: boolean;
}
export async function askDividendAdvisor(config: DividendAdvisorConfig, context: DividendAdvisorContext, question: string,
  history: DividendAdvisorMessage[] = [], options: DividendAdvisorOptions = {}): Promise<string> {
  const normalized = validateDividendAdvisorConfig(config);
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new DividendAdvisorError('QUESTION');
  const includeSnapshot = options.includeSnapshot !== false;
  const snapshot = includeSnapshot ? buildSnapshotPayload(context, question, options.explanationResearch) : '';
  if (snapshot.length > 500_000) throw new DividendAdvisorError('CONTEXT');
  const system = options.systemPrompt ?? dividendAdvisorSystemPrompt(options.language ?? 'zh');
  const previous = history.slice(-8).filter(message => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .map(message => ({ role: message.role, content: message.content.slice(0, MAX_ANSWER_LENGTH) }));
  const extra = options.extraContext?.trim() ? `\n\n${options.extraContext.trim()}` : '';
  const messages = [...previous, {
    role: 'user' as const,
    content: includeSnapshot
      ? `Current dividend snapshot (JSON data):\n${snapshot}${extra}\n\nUser question:\n${question.trim()}`
      : `${question.trim()}${extra}`,
  }];
  return sendDividendAdvisorRequest(normalized, system, messages, options);
}

export async function requestDividendAdvisor(config: DividendAdvisorConfig, system: string,
  messages: Pick<DividendAdvisorMessage, 'role' | 'content'>[], options: DividendAdvisorOptions = {}): Promise<string> {
  return sendDividendAdvisorRequest(validateDividendAdvisorConfig(config), system, messages, options);
}

async function sendDividendAdvisorRequest(normalized: DividendAdvisorConfig, system: string,
  messages: Pick<DividendAdvisorMessage, 'role' | 'content'>[], options: DividendAdvisorOptions): Promise<string> {
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
    if (response.status === 401 || response.status === 403) {
      throw new DividendAdvisorError('AUTH', { httpStatus: response.status, detail: extractSafeProviderErrorDetail(response.data, normalized.apiKey) });
    }
    if (response.status === 429) {
      throw new DividendAdvisorError('RATE_LIMIT', { httpStatus: response.status, detail: extractSafeProviderErrorDetail(response.data, normalized.apiKey) });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DividendAdvisorError('HTTP', { httpStatus: response.status, detail: extractSafeProviderErrorDetail(response.data, normalized.apiKey) });
    }
    return parseAnswer(normalized.protocol, response.data, normalized.apiKey);
  } catch (cause) {
    throw classifyTransportError(cause, Boolean(options.signal?.aborted));
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Standalone built-in glossary fallback used only when AI is not configured. */
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
  return concept ? { answer: concept[chinese ? 'zh' : 'en'] } : undefined;
}

export interface DividendAdvisorResult {
  answer: string; actions: DividendPlanProposal[]; localAnswer: string; checksText: string;
  explanationStatus: 'not_needed' | 'pending' | 'complete' | 'unconfigured' | 'unavailable' | 'rejected';
  errorCode?: string;
  httpStatus?: number;
  errorDetail?: string;
}

interface DeterministicActionPlan {
  actions: DividendPlanProposal[];
  actionSummary: string;
  unchangedStocks: string[];
  blockedSummaries: string[];
  explicitPause: boolean;
  regenerate: boolean;
  resumeGuide: string;
  technicalNotice: string;
  localExample: string | null;
}

function savedGridForDiff(stock: DividendAdvisorContext['stockPlan']['stocks'][number]) {
  return {
    buyLevels: stock.savedBuyLevels ?? (stock.checkSummary.grid.origin === 'saved' ? stock.checkSummary.grid.buyLevels : undefined),
    sellLevels: stock.savedSellLevels ?? (stock.checkSummary.grid.origin === 'saved' ? stock.checkSummary.grid.sellLevels : undefined),
    buyPaused: stock.buyPaused,
  };
}

function computeDeterministicActions(context: DividendAdvisorContext, question: string, language: string): DeterministicActionPlan {
  const checkedPricingPlan = (code: string, pricing: DividendPricingResult | undefined) => {
    const check = context.stockPlan.stocks.find(stock => stock.code === code)?.checkSummary;
    if (check?.freshness.evidenceStatus && check.freshness.evidenceStatus !== 'current'
      || check?.grid.reasons.includes('pricing_basis_changed')
      || check?.grid.reasons.includes('tax_changed') && !check.currentPlan) return null;
    return pricing ? dividendPricingPlan(pricing) : null;
  };
  let actions: DividendPlanProposal[] = [];
  const chinese = language.startsWith('zh');
  const dictionary = chinese ? dividendCheckZh : dividendCheckEn;
  const ui = dividendExplanationUi[chinese ? 'zh' : 'en'];
  const resumeGuide = /恢复|\b(?:resume|restart|reactivate)\b/i.test(question) ? dividendAdvisorResumeGuide[chinese ? 'zh' : 'en'] : '';
  const pricingReasons = new Map<string, string>();
  const unchangedStocks: string[] = [];
  const blockedSummaries: string[] = [];
  const summaries: string[] = [];
  const explanationClause = (value: string) => /解释|为何|为什么|什么是|是什么意思|如何理解|概念|原理|例子|举例|\b(?:explain|why|what is|what does|define|example)\b/i.test(value);
  const requestClauses = question.split(/[，。；！？\n]+|(?:并且|同时|然后|并)|\band\b/i).map(value => value.trim()).filter(Boolean);
  const changeQuestion = requestClauses.filter(value => !explanationClause(value)).join(' ');
  const explicitPause = requestClauses.some(clause => !explanationClause(clause)
    && /^(?:请|帮我|麻烦|please\s+)?(?:暂停|停止|关闭)[^，。；！？\n]{0,60}(?:加仓|买入|买进)|^(?:please\s+)?(?:pause|stop|disable)\s+(?:additional\s+)?(?:buying|buys|additions)\b/i.test(clause));
  const namedStocks = context.stockPlan.stocks.filter(stock => question.includes(stock.name) || question.includes(stock.code));
  if (explicitPause && (context.activeStrategy === 'stocks' || namedStocks.length || /股票|\bstocks?\b/i.test(changeQuestion))) {
    const targets = namedStocks.length ? namedStocks : /现有|所有|全部|existing|current|all/i.test(question) ? context.stockPlan.stocks : [];
    for (const stock of targets.slice(0, 10)) {
      const pauseProposal: DividendPlanProposal = { id: `pause-${stock.code}`, code: stock.code, buyPaused: true, reason: dictionary.div_check_pause_draft };
      if (hasEffectiveGridPlanChange(savedGridForDiff(stock), pauseProposal)) actions.push(pauseProposal);
    }
  }
  const negated = /(?:不要|别|无需|不用|不必|暂不|先不|不想|不需要)[^，。；！？\n]{0,12}(?:生成|重做|重建|重设|重算|更新|调整|修正|修改|定价|计算|估算|给出|给个|提供)/.test(question)
    || /(?:do not|don't|no need to|without)\s+(?:regenerat|generat|rebuild|recalculat|revis|adjust|replac|calculat|estimat)/i.test(question);
  if (negated) actions = actions.flatMap(({ buyLevels, sellLevels, ...action }) => {
    void buyLevels; void sellLevels;
    return action.buyPaused === undefined ? [] : [action];
  });
  // Trigger grid regeneration ONLY for explicit requests to generate/recalculate/update a grid or price plan,
  // never for general discussion, single-stock analysis, or portfolio Q&A.
  const regenerate = !negated && (
    /(?:重新生成|生成|重做|重建|重设|重算|重新计算|重新定价|更新|调整|修正|修改)[^，。；！？\n]{0,20}(?:网格|价格计划|买卖档位|买价|买入价|定价|网格计划|计划|价格)/.test(changeQuestion)
    || /(?:网格|价格计划|买卖档位|买价|买入价|定价|网格计划)[^，。；！？\n]{0,10}(?:重新生成|生成|重做|重建|重设|重算|重新计算|重新定价|更新|调整|修正|修改)/.test(changeQuestion)
    || /^(?:请|帮我|麻烦)?(?:重新)?计算(?:一下)?[^，。；！？\n]{0,20}(?:价格|网格|买价|买入价|定价)[。！？?!\s]*$/.test(changeQuestion)
    || /(?:regenerat|rebuild|recalculat|reprice|update|revis|adjust|replac)\w*[\s\S]{0,40}(?:grid|price\s+plan|buy\s+price|levels|\bplan\b|\bprice\b)/i.test(changeQuestion)
    || /\bgenerat\w*\s+(?:a\s+|new\s+)?(?:grid|price\s+plan)\b/i.test(changeQuestion)
  );
  if (context.activeStrategy === 'stocks' && regenerate) {
    const aliases: Record<string, string[]> = { '601288': ['农行'], '601398': ['工行'], '601939': ['建行'], '601988': ['中行'], '601328': ['交行'], '600036': ['招行'], '601658': ['邮储'] };
    const named = context.stockPlan.stocks.filter(stock => [stock.code, stock.name,
      stock.name.replace(/集团|股份|有限公司/g, '').trim(), ...aliases[stock.code] ?? []]
      .some(name => name.length >= 2 && changeQuestion.toLowerCase().includes(name.toLowerCase())));
    const general = /所有|全部|各只|整个组合|all (?:stock|grid|plan)/i.test(changeQuestion)
      || /^(?:请|帮我|麻烦|能否|可以|我要|我想|再|重新|生成|新建|调整|更新|重做|重算|计算|一下|一个|新的|当前|我的|现有|的|网格|计划|买价|买入价|价格|定价|方案|[。！？\s])+$/.test(changeQuestion);
    const scope = named.length ? named : general ? context.stockPlan.stocks : [];
    for (const saved of scope.slice(0, 10)) {
      const pricing = context.research?.stocks.find(stock => stock.code === saved.code)?.pricing;
      const plan = checkedPricingPlan(saved.code, pricing);
      if (!pricing || !plan) {
        const gaps = pricing?.blockers.map(issue => dividendPricingIssueText(issue, chinese ? 'zh' : 'en')) ?? [];
        const blocked = chinese ? `${saved.name}：${gaps.length ? gaps.join('；') : '尚无完整定价数据，请先完成该股票研究'}。补齐后才能生成经典股息率网格，已有计划保留。`
          : `${saved.name}: ${gaps.length ? gaps.join('; ') : 'complete pricing evidence has not been collected'}. Complete these inputs before calculating the classic cash-yield grid; the saved plan is preserved.`;
        blockedSummaries.push(blocked);
        summaries.push(blocked);
        continue;
      }
      const savedPlan = savedGridForDiff(saved);
      const levelsProposal: DividendPlanProposal = { id: `reprice-${saved.code}`, code: saved.code, reason: '', ...plan };
      const levelsChanged = hasEffectiveGridPlanChange(savedPlan, levelsProposal);
      const pauseProposal: DividendPlanProposal | null = explicitPause
        ? { id: `pause-${saved.code}`, code: saved.code, buyPaused: true, reason: dictionary.div_check_pause_draft } : null;
      const pauseChanged = pauseProposal ? hasEffectiveGridPlanChange(savedPlan, pauseProposal) : false;

      if (!levelsChanged && !pauseChanged) {
        unchangedStocks.push(`${saved.name} (${saved.code})`);
        summaries.push(chinese
          ? `${saved.name}（${saved.code}）：当前已保存的买卖网格已与最新核验计算结果一致，无需更新。`
          : `${saved.name} (${saved.code}): the saved buy and sell grid already matches the latest verified calculation; no update is needed.`);
        continue;
      }

      if (!levelsChanged && pauseChanged && pauseProposal) {
        unchangedStocks.push(`${saved.name} (${saved.code})`);
        actions = actions.filter(action => action.code !== saved.code);
        actions.push(pauseProposal);
        summaries.push(chinese
          ? `${saved.name}（${saved.code}）：买卖网格与最新计算一致，已准备暂停加仓草案。`
          : `${saved.name} (${saved.code}): grid levels already match the latest calculation; a pause draft is ready.`);
        continue;
      }

      const money = (value: number) => (value / 100).toFixed(2);
      const pauseDetails = (pricing.pauseReasons ?? []).map(issue => dividendPricingIssueText(issue, chinese ? 'zh' : 'en')).join(chinese ? '；' : '; ');
      const reason = chinese
        ? `以最近已核验批次分红按固定股息率重算四档买入、四档卖出，每档25%；5%股息率中性参考线${money(pricing.theoreticalPriceMinor!)}元。保留当前手动暂停设置，仓位按价格档位、预算与持仓判断。风险提示：${pauseDetails || '本次无额外定价提示'}。`
        : `Rebuild four buy and four sell levels from verified recent-batch cash dividends and fixed cash yields, 25% each. The 5% neutral reference is CNY ${money(pricing.theoreticalPriceMinor!)}. Preserve the manual pause setting; actions depend on price levels, budget and holdings. Alerts: ${pauseDetails || 'no additional pricing alerts'}.`;
      pricingReasons.set(saved.code, reason.slice(0, 2000));
      actions = actions.filter(action => action.code !== saved.code);
      actions.push({ id: `reprice-${saved.code}`, code: saved.code, reason: reason.slice(0, 2000),
        ...(pauseChanged ? { buyPaused: true } : {}),
        ...plan });
      const dividend = ((pricing.d1Micros ?? 0) / 1e6).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      const window = pricing.dividendBase?.reportPeriods.join('／') ?? '';
      summaries.push(chinese ? `${saved.name}：最近已核验批次分红${dividend}元/股${pricing.taxBps ? '（按所选持有期扣税后）' : '（税前；所选持有期税率0%）'}，所属期${window}。按固定股息率计算，买入四档${plan.buyLevels.map(level => money(level.priceMinor!)).join('／')}元；卖出四档${plan.sellLevels.map(level => money(level.priceMinor!)).join('／')}元，每档25%。5%股息率中性参考线${money(pricing.theoreticalPriceMinor!)}元，是纪律参考，不是公允价值。预览确认后同时替换两侧，保留当前手动暂停设置。风险提示：${pauseDetails || '本次无额外定价提示'}；仓位仍按价格档位、预算和持仓判断。`
        : `${saved.name}: verified recent-batch cash dividend CNY ${dividend} per share (${pricing.taxBps ? 'after the selected holding-period tax' : 'pretax; selected tax rate 0%'}), window ${window}. Fixed-yield buy levels ${plan.buyLevels.map(level => money(level.priceMinor!)).join(' / ')}; sell levels ${plan.sellLevels.map(level => money(level.priceMinor!)).join(' / ')}, 25% each. The 5% neutral reference is CNY ${money(pricing.theoreticalPriceMinor!)}; this is a discipline reference, not fair value. Preview and confirm to replace both sides while preserving the manual pause setting. Alerts: ${pauseDetails || 'no additional pricing alerts'}. Actions depend on price levels, budget and holdings.`);
    }
  }
  let technicalNotice = '';
  if (context.activeStrategy === 'stocks') {
    const dateCutoff = new Date(Date.parse(context.generatedAt) - 10 * 86400_000).toISOString().slice(0, 10);
    const accelerating = context.research?.stocks.filter(stock => stock.technical?.state === 'accelerating_down'
      && stock.technical.currentUsable && stock.technical.asOf >= dateCutoff && context.stockPlan.stocks.some(saved => saved.code === stock.code && !saved.buyPaused)) ?? [];
    if (accelerating.length) {
      technicalNotice = chinese
        ? `风险提示：${accelerating.map(stock => stock.name).join('、')}的已获取日线显示下跌加速，短期波动风险较高；不自动暂停，仍按价格档位、预算和持仓自主决定。`
        : `Risk alert: the downloaded daily data for ${accelerating.map(stock => stock.name).join(', ')} show an accelerating decline and higher short-term volatility. This does not pause the grid; decide using price levels, budget and holdings.`;
    }
  }
  actions = actions.slice(0, 10).map(action => {
    const pricing = context.research?.stocks.find(stock => stock.code === action.code)?.pricing;
    const gridProvenance = pricing && (action.buyLevels || action.sellLevels) ? dividendPricingProvenance(pricing, context.research!.generatedAt) : undefined;
    const reason = action.buyLevels || action.sellLevels ? pricingReasons.get(action.code) ?? dictionary.div_check_help_grid : dictionary.div_check_pause_draft;
    return { ...action, ...(gridProvenance ? { gridProvenance } : {}), reason };
  });
  let localExample: string | null = null;
  if (/(?:例子|举例|example)/i.test(question) && /股息率|dividend yield|cash yield/i.test(question) && !regenerate && !explicitPause) {
    const cash = /每股(?:现金)?分红(?:为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*元/i.exec(question)
      ?? /(?:cash\s+)?dividends?\s+per\s+share(?:\s+(?:of|is))?\s*(?:CNY|¥)?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(question);
    const price = /股价(?:为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*元/i.exec(question)
      ?? /share\s+price(?:\s+(?:of|is))?\s*(?:CNY|¥)?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(question);
    const inputs = cash && price ? [Number(cash[1]), Number(price[1])] : /\d/.test(question) ? null : [0.5, 10];
    localExample = inputs ? renderDividendExplanation(JSON.stringify({ version: 1, blocks: [{ type: 'example', formula: 'cash_yield', inputs }] }), [], language) ?? ui.invalidTeachingInputs : ui.exampleInputsMissing;
  }
  const actionSummary = humanizeDividendPricingIssues([
    actions.some(action => action.buyPaused === true) ? dictionary.div_check_pause_draft : '',
    resumeGuide,
    summaries.join('\n\n'),
  ].filter(Boolean).join('\n\n'), chinese ? 'zh' : 'en');
  return { actions, actionSummary, unchangedStocks, blockedSummaries, explicitPause, regenerate, resumeGuide, technicalNotice, localExample };
}

/** Deterministic action & local helper computation. Read-only; never replaces real AI analysis. */
export function buildDividendAdvisorLocalResult(context: DividendAdvisorContext, question: string, language = 'zh', _explanationResearch?: DividendResearchSnapshot, _explanationTopic = question): DividendAdvisorResult {
  void _explanationResearch; void _explanationTopic;
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new DividendAdvisorError('QUESTION');
  const chinese = language.startsWith('zh');
  const det = computeDeterministicActions(context, question, language);
  const allChecks = [...context.stockPlan.stocks.map(stock => stock.checkSummary), ...context.fundPlan.funds.map(fund => fund.checkSummary)];
  const namedChecks = allChecks.filter(check => question.includes(check.name) || !!check.code && question.includes(check.code));
  const scope = namedChecks.length ? namedChecks : /股票.*基金|stocks.*funds|全部|所有|both|all/i.test(question) ? allChecks
    : context.activeStrategy === 'stocks' ? context.stockPlan.stocks.map(stock => stock.checkSummary) : context.fundPlan.funds.map(fund => fund.checkSummary);
  const checksText = dividendCheckSummaryText(scope, language);
  if (det.localExample) {
    return { answer: det.localExample, actions: [], localAnswer: det.localExample, checksText, explanationStatus: 'not_needed' };
  }
  const glossary = !det.regenerate && !det.explicitPause ? standaloneConceptExplanation(question, chinese) : undefined;
  if (glossary) {
    return { answer: glossary.answer, actions: [], localAnswer: glossary.answer, checksText, explanationStatus: 'not_needed' };
  }
  return {
    answer: det.actionSummary,
    actions: det.actions,
    localAnswer: det.actionSummary,
    checksText,
    explanationStatus: 'pending',
  };
}

/** Calls the configured AI provider for genuine analysis while keeping grid/pause actions
 * strictly deterministic and suppressing no-op grid adjustment proposals. Never dumps raw
 * local check walls when AI is unconfigured or fails to connect. */
export async function askDividendAdvisorWithActions(config: DividendAdvisorConfig | null, context: DividendAdvisorContext, question: string,
  history: DividendAdvisorMessage[] = [], options: DividendAdvisorOptions & { onLocalResult?: (result: DividendAdvisorResult) => void } = {}): Promise<DividendAdvisorResult> {
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new DividendAdvisorError('QUESTION');
  const language = options.language ?? 'zh', chinese = language.startsWith('zh');
  if (options.signal?.aborted) throw new DividendAdvisorError('CANCELLED');

  const det = computeDeterministicActions(context, question, language);

  // Explicit numeric teaching arithmetic is computed locally so exact numbers are never hallucinated.
  if (det.localExample) {
    const result: DividendAdvisorResult = { answer: det.localExample, actions: [], localAnswer: det.localExample, checksText: '', explanationStatus: 'not_needed' };
    options.onLocalResult?.(result);
    return result;
  }

  // When AI is NOT configured:
  // - Honor explicit deterministic actions (pause / reprice) or built-in glossary concepts cleanly.
  // - For all real Q&A / analysis requests, tell the user clearly that AI is not configured (no check dumps).
  if (!config) {
    const glossary = !det.regenerate && !det.explicitPause ? standaloneConceptExplanation(question, chinese) : undefined;
    if (glossary) {
      const result: DividendAdvisorResult = { answer: glossary.answer, actions: [], localAnswer: glossary.answer, checksText: '', explanationStatus: 'not_needed' };
      options.onLocalResult?.(result);
      return result;
    }
    if (det.actions.length > 0 || det.unchangedStocks.length > 0 || det.blockedSummaries.length > 0) {
      const result: DividendAdvisorResult = { answer: det.actionSummary, actions: det.actions, localAnswer: det.actionSummary, checksText: '', explanationStatus: 'not_needed' };
      options.onLocalResult?.(result);
      return result;
    }
    return {
      answer: formatDividendAdvisorFailure(new DividendAdvisorError('CONFIG'), language),
      actions: [],
      localAnswer: '',
      checksText: '',
      explanationStatus: 'unconfigured',
      errorCode: 'CONFIG',
    };
  }

  // Build concise factual context for explicit deterministic actions so the AI's answer stays consistent
  // with any attached previewable proposals or unchanged-grid determinations.
  const deterministicNotes: string[] = [];
  if (det.actions.length > 0) {
    deterministicNotes.push(chinese
      ? `系统已生成可预览确认的计划调整草案：${det.actions.map(action => `${action.code}${action.buyLevels ? '（四档买卖价格已按最新核验分红重算）' : ''}${action.buyPaused ? '（暂停新增买入）' : ''}`).join('、')}。`
      : `Deterministic previewable draft(s) prepared by the app: ${det.actions.map(action => `${action.code}${action.buyLevels ? ' (4-tier buy/sell prices recalculated from verified dividends)' : ''}${action.buyPaused ? ' (pause new buys)' : ''}`).join(', ')}.`);
  }
  if (det.unchangedStocks.length > 0) {
    deterministicNotes.push(chinese
      ? `以下股票当前已保存的网格已与最新核验计算结果完全一致，系统未生成重复的调整卡片：${det.unchangedStocks.join('、')}。`
      : `The saved grids already match the latest verified calculation (no redundant update card emitted): ${det.unchangedStocks.join(', ')}.`);
  }
  if (det.actionSummary) {
    deterministicNotes.push(det.actionSummary);
  }
  if (det.technicalNotice) {
    deterministicNotes.push(det.technicalNotice);
  }

  const isFollowup = (value: string) => /^(?:请|再|能否)?(?:解释一下|解释下|换个简单说法|换一种说法|说简单些|简单点|再简单点|再详细一点|详细一点|继续|继续解释)[。？！?!.\s]*$|^(?:please\s+)?(?:explain(?:\s+that)?|simplify(?:\s+that)?|say it more simply|in simpler terms|explain more|continue|go on)[。？！?!.\s]*$/i.test(value.trim());
  const followupTopic = isFollowup(question)
    ? history.filter(message => message.role === 'user' && !isFollowup(message.content)).at(-1)?.content
    : undefined;
  const recentWindow = history.slice(-8);
  if (followupTopic && !recentWindow.some(message => message.role === 'user' && message.content === followupTopic)) {
    deterministicNotes.push(chinese
      ? `用户本轮是继续追问，更早前的原始讨论主题为：${followupTopic}`
      : `This is a follow-up to an earlier user topic: ${followupTopic}`);
  }

  const extraContext = deterministicNotes.length
    ? `[App deterministic status — follow these facts without emitting extra JSON blocks]\n${deterministicNotes.join('\n')}`
    : undefined;

  try {
    const raw = await askDividendAdvisor(config, context, question.trim(), history, { ...options, includeSnapshot: true, extraContext });
    // Strip any accidental machine-action JSON block from provider prose; untrusted model drafts
    // never originate executable actions — only deterministic verified proposals in `det.actions` do.
    const allowedCodes = context.stockPlan.stocks.map(stock => stock.code);
    const parsed = parseDividendAdvisorActions(raw, allowedCodes);
    const cleaned = humanizeDividendPricingIssues(parsed.answer, language).trim();
    if (!cleaned) {
      if (det.actionSummary) {
        return { answer: det.actionSummary, actions: det.actions, localAnswer: det.actionSummary, checksText: '', explanationStatus: 'complete' };
      }
      throw new DividendAdvisorError('RESPONSE', { detail: 'empty' });
    }
    return {
      answer: cleaned,
      actions: det.actions,
      localAnswer: det.actionSummary,
      checksText: '',
      explanationStatus: 'complete',
    };
  } catch (cause) {
    if (cause instanceof DividendAdvisorError && cause.code === 'CANCELLED') throw cause;
    const err = cause instanceof DividendAdvisorError ? cause : new DividendAdvisorError('NETWORK');
    return {
      answer: formatDividendAdvisorFailure(err, language),
      actions: det.actions,
      localAnswer: det.actionSummary,
      checksText: '',
      explanationStatus: 'unavailable',
      errorCode: err.code,
      httpStatus: err.httpStatus,
      errorDetail: err.detail,
    };
  }
}
