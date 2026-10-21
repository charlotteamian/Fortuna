import { Capacitor, CapacitorHttp } from '@capacitor/core';
import Dexie, { type Table } from 'dexie';
import { holdingRecognitionProviderBody } from '../lib/holdingRecognitionProviders.ts';
import { dividendAdvisorReadableSnapshot, dividendAdvisorSystemPrompt, type DividendAdvisorContext, type DividendAdvisorMessage } from '../lib/dividendAdvisor.ts';
import { validateHoldingRecognitionConfig, type HoldingRecognitionConfig } from './holdingRecognitionService.ts';
import { parseDividendAdvisorActions } from '../lib/dividendAdvisorActions.ts';

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

export async function askDividendAdvisorWithActions(...args: Parameters<typeof askDividendAdvisor>) {
  const raw = await askDividendAdvisor(...args);
  const context = args[1];
  const result = parseDividendAdvisorActions(raw, context.stockPlan.stocks.map(stock => stock.code));
  const chinese = (args[4]?.language ?? 'zh').startsWith('zh');
  // Make the user's pacing rule deterministic even if a provider omits a draft.
  // A draft always needs a fresh preview and a separate confirmation before writing.
  if (context.activeStrategy === 'stocks') {
    const dateCutoff = new Date(Date.parse(context.generatedAt) - 10 * 86400_000).toISOString().slice(0, 10);
    const accelerating = context.research?.stocks.filter(stock => stock.technical?.state === 'accelerating_down'
      && stock.technical.currentUsable && stock.technical.asOf >= dateCutoff && context.stockPlan.stocks.some(saved => saved.code === stock.code && !saved.buyPaused)) ?? [];
    for (const stock of accelerating.slice(0, 10)) {
      result.actions = result.actions.filter(action => action.code !== stock.code);
      result.actions.push({ id: `pause-${stock.code}`, code: stock.code, buyPaused: true,
        reason: chinese ? `截至${stock.technical!.asOf}，近期下跌正在加速。先暂停加仓；跌势放缓、短期均线趋稳后复核原网格。`
          : `As of ${stock.technical!.asOf}, the decline is accelerating. Pause additional buying and review the grid once momentum eases and short-term averages stabilise.` });
    }
    if (accelerating.length) result.answer = `${chinese
      ? `加仓节奏检查：${accelerating.map(stock => stock.name).join('、')}的已获取日线显示下跌加速，先暂停加仓并复核网格；触价本身不足以支持加仓。`
      : `Pacing check: the downloaded daily data for ${accelerating.map(stock => stock.name).join(', ')} show an accelerating decline. Pause additional buying and review the grid; a reached price alone is insufficient.`}\n\n${result.answer}`;
  }
  return result;
}
