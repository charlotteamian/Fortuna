import {
  buildClassicDailyAdviceMarkdown, scopeClassicAdvicePlans,
} from '../lib/dividendClassicAdvice.ts';
import type { ClassicStockPlan } from '../lib/dividendClassicStrategy.ts';
import {
  dividendExplanationPrompt, renderDividendExplanation, type DividendExplanationFact,
} from '../lib/dividendAdvisorExplanation.ts';
import { dateInChina } from '../lib/dividendWorkbench.ts';
import {
  DividendAdvisorError, loadDividendAdvisorConfig, requestDividendAdvisor, type DividendAdvisorTransport,
} from './dividendAdvisorService.ts';

export interface ClassicAiAdviceOutput {
  localMarkdown: string;
  modelMarkdown?: string;
  configured: boolean;
  explanationStatus?: 'unconfigured' | 'unavailable' | 'rejected' | 'complete';
}

export async function generateClassicDividendAdvice(options: {
  plans: ClassicStockPlan[];
  selectedCode?: string;
  totalBudgetMinor?: number;
  question?: string;
  language?: string;
  asOf?: string;
  signal?: AbortSignal;
  transport?: DividendAdvisorTransport;
  onLocalReady?: (localMarkdown: string) => void;
}): Promise<ClassicAiAdviceOutput> {
  const language = options.language ?? 'zh';
  const now = Date.now();
  const asOf = options.asOf ?? dateInChina(new Date(now));
  const localMarkdown = buildClassicDailyAdviceMarkdown(options.plans, { selectedCode: options.selectedCode, language, asOf, now });
  if (options.signal?.aborted) throw new DividendAdvisorError('CANCELLED');
  options.onLocalReady?.(localMarkdown);

  const question = options.question?.trim();
  if (!question) return { localMarkdown, configured: false };
  const config = await loadDividendAdvisorConfig().catch(() => null);
  if (!config) return { localMarkdown, configured: false, explanationStatus: 'unconfigured' };

  const zh = language.startsWith('zh');
  const plans = scopeClassicAdvicePlans(options.plans, options.selectedCode);
  const facts: DividendExplanationFact[] = plans
    .filter(plan => plan.base.tier === 'recent_batches' && plan.base.netDpsMicros !== undefined)
    .map(plan => {
    const subject = `stock:${plan.code}`;
    const text = buildClassicDailyAdviceMarkdown([plan], { selectedCode: plan.code, language, asOf, now })
      .replace(/\s*\n- /g, ' · ').replace(/[\r\n]+/g, ' ').replace(/\*\*|###/g, '').trim();
    const net = plan.base.netDpsMicros as number;
    const basis = zh ? `分红基数 ${(net / 1e6).toFixed(4)} 元/股（税后）`
      : `After-tax dividend basis ¥${(net / 1e6).toFixed(4)}/share`;
    return { id: `${subject}:grid`, text: `${text} · ${basis}`, kind: 'check', subject, subjectName: plan.name };
  });

  try {
    const system = dividendExplanationPrompt(facts, language);
    const raw = await requestDividendAdvisor(config, system, [{ role: 'user', content: question.slice(0, 2000) }], options);
    const modelMarkdown = renderDividendExplanation(raw, facts, language);
    if (!modelMarkdown) return { localMarkdown, configured: true, explanationStatus: 'rejected' };
    return { localMarkdown, modelMarkdown, configured: true, explanationStatus: 'complete' };
  } catch (error) {
    if (options.signal?.aborted || error instanceof DividendAdvisorError && error.code === 'CANCELLED') throw error;
    return { localMarkdown, configured: true, explanationStatus: 'unavailable' };
  }
}
