import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { holdingRecognitionProviderBody } from '../lib/holdingRecognitionProviders.ts';
import {
  buildClassicDailyAdviceMarkdown,
  classicDividendAdvisorSystemPrompt,
  type ClassicStockPlan,
} from '../lib/dividendClassicStrategy.ts';
import {
  loadDividendAdvisorConfig,
  validateDividendAdvisorConfig,
  type DividendAdvisorConfig,
} from './dividendAdvisorService.ts';

function resolveEndpoint(config: DividendAdvisorConfig): string {
  const url = new URL(config.baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (config.protocol === 'openai') {
    url.pathname = /\/chat\/completions$/.test(path) ? path : `${path || '/v1'}/chat/completions`;
  } else if (config.protocol === 'anthropic') {
    url.pathname = /\/messages$/.test(path) ? path : `${path || '/v1'}/messages`;
  } else if (/:generateContent$/.test(path)) {
    url.pathname = path;
  } else {
    const base = path || '/v1beta';
    url.pathname = `${base}${/\/models$/.test(base) ? '' : '/models'}/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
  }
  return url.toString();
}

function extractText(protocol: DividendAdvisorConfig['protocol'], raw: unknown): string {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return '';
  const data = parsed as Record<string, unknown>;
  if (protocol === 'openai' && Array.isArray(data.choices)) {
    const msg = (data.choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
    if (typeof msg?.content === 'string') return msg.content.trim();
  } else if (protocol === 'gemini' && Array.isArray(data.candidates)) {
    const content = (data.candidates[0] as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined;
    if (Array.isArray(content?.parts)) {
      return content.parts
        .map(p => (p && typeof p === 'object' && !(p as Record<string, unknown>).thought && typeof (p as Record<string, unknown>).text === 'string' ? (p as Record<string, unknown>).text : ''))
        .join('')
        .trim();
    }
  } else if (protocol === 'anthropic' && Array.isArray(data.content)) {
    return data.content
      .map(p => (p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string' ? (p as Record<string, unknown>).text : ''))
      .join('')
      .trim();
  }
  return '';
}

export interface ClassicAiAdviceOutput {
  localMarkdown: string;
  modelMarkdown?: string;
  configured: boolean;
  error?: string;
}

export async function generateClassicDividendAdvice(options: {
  plans: ClassicStockPlan[];
  selectedCode?: string;
  totalBudgetMinor?: number;
  question?: string;
  language?: string;
  asOf?: string;
  signal?: AbortSignal;
  onLocalReady?: (localMarkdown: string) => void;
}): Promise<ClassicAiAdviceOutput> {
  const language = options.language ?? 'zh';
  const localMarkdown = buildClassicDailyAdviceMarkdown(options.plans, {
    selectedCode: options.selectedCode,
    totalBudgetMinor: options.totalBudgetMinor,
    language,
    asOf: options.asOf,
  });
  options.onLocalReady?.(localMarkdown);

  const config = await loadDividendAdvisorConfig().catch(() => null);
  if (!config) {
    return { localMarkdown, configured: false };
  }

  try {
    const normalized = validateDividendAdvisorConfig(config);
    const yuan = (minor?: number) => (minor === undefined ? null : Number((minor / 100).toFixed(2)));
    const pct = (bps?: number) => (bps === undefined ? null : Number((bps / 100).toFixed(2)));

    const contextPayload = {
      asOf: options.asOf ?? new Date().toISOString().slice(0, 10),
      totalBudgetCNY: yuan(options.totalBudgetMinor),
      selectedStockCode: options.selectedCode ?? null,
      stocks: options.plans
        .filter(p => p.group !== 'hidden' || p.shares > 0 || p.code === options.selectedCode)
        .map(p => ({
          code: p.code,
          name: p.name,
          group: p.group,
          sector: p.sector,
          heldShares: p.shares,
          allocatedBudgetCNY: yuan(p.budgetMinor),
          weightPercent: pct(p.weightBps),
          currentPriceCNY: yuan(p.quotePriceMinor),
          afterTaxYieldPercent: pct(p.currentNetYieldBps),
          preTaxYieldPercent: pct(p.currentGrossYieldBps),
          neutral5PctAnchorCNY: yuan(p.neutralPriceMinor),
          annualDpsGrossCNY: Number((p.base.grossDpsMicros / 1e6).toFixed(4)),
          annualDpsNetCNY: Number((p.base.netDpsMicros / 1e6).toFixed(4)),
          dividendBasePeriod: p.base.periodLabel,
          buyTiers: p.buyRows.map(r => ({
            tier: r.level,
            targetYieldPercent: pct(r.yieldBps),
            triggerPriceCNY: yuan(r.priceMinor),
            gapPercent: pct(r.gapFromQuoteBps),
            targetShares: r.targetShares ?? null,
            suggestedAddShares: r.incrementalShares ?? null,
            triggered: r.touched,
          })),
          sellTiers: p.sellRows.map(r => ({
            tier: r.level,
            targetYieldPercent: pct(r.yieldBps),
            triggerPriceCNY: yuan(r.priceMinor),
            gapPercent: pct(r.gapFromQuoteBps),
            suggestedSellShares: r.sellShares ?? null,
            triggered: r.touched,
          })),
          todayConclusion: p.todayAction.headlineZh,
        })),
    };

    const userPrompt = options.question?.trim()
      || (options.selectedCode
        ? `请重点分析 ${options.plans.find(p => p.code === options.selectedCode)?.name ?? options.selectedCode} 今日的网格触发情况、当前股息率性价比以及具体买卖操作建议。`
        : '请根据当前红利股票池的实时价格、股息率与四买四卖网格触发情况，给出今天具体的操作建议清单（哪些触发买卖、买多少股、未触发的距离买1档还差多少）。');

    const system = classicDividendAdvisorSystemPrompt(language);
    const fullUserContent = `当前红利网格实时数据 (JSON):\n${JSON.stringify(contextPayload)}\n\n用户问题:\n${userPrompt}`;

    let body: Record<string, unknown>;
    if (normalized.protocol === 'openai') {
      body = {
        model: normalized.model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: fullUserContent },
        ],
        ...holdingRecognitionProviderBody(normalized),
      };
    } else if (normalized.protocol === 'anthropic') {
      body = {
        model: normalized.model,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: fullUserContent }],
      };
    } else {
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: fullUserContent }] }],
        generationConfig: { maxOutputTokens: 4096 },
      };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (normalized.protocol === 'openai') headers.Authorization = `Bearer ${normalized.apiKey}`;
    else if (normalized.protocol === 'gemini') headers['x-goog-api-key'] = normalized.apiKey;
    else {
      headers['x-api-key'] = normalized.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const url = resolveEndpoint(normalized);
    let rawResponseData: unknown;
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.post({
        url,
        headers,
        data: body,
        responseType: 'json',
        connectTimeout: 15_000,
        readTimeout: 45_000,
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
      rawResponseData = response.data;
    } else {
      if (headers['anthropic-version']) headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      rawResponseData = await response.text();
    }

    const modelText = extractText(normalized.protocol, rawResponseData);
    return {
      localMarkdown,
      modelMarkdown: modelText || undefined,
      configured: true,
    };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return {
      localMarkdown,
      configured: true,
      error: err instanceof Error ? err.message : 'AI_REQUEST_FAILED',
    };
  }
}
