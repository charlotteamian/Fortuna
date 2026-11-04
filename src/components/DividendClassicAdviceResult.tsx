import { useTranslation } from 'react-i18next';
import DividendAdvisorMarkdown from './DividendAdvisorMarkdown';
import { dividendExplanationUi } from '../i18n/dividendAdvisorExplanationTranslations';
import type { ClassicAiAdviceOutput } from '../services/dividendClassicAdvisorService';
import './DividendClassicAdviceResult.css';

export default function DividendClassicAdviceResult({ output, targetLabel, amountVisible = true }: {
  output: ClassicAiAdviceOutput;
  targetLabel?: string;
  amountVisible?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (!amountVisible) return <p className="div-advisor-hidden" role="status">{t('div_ai_reading_hidden')}</p>;
  const ui = dividendExplanationUi[i18n.language.startsWith('zh') ? 'zh' : 'en'];
  const notice = output.explanationStatus === 'unconfigured' ? ui.notConfigured
    : output.explanationStatus === 'rejected' ? ui.rejected
      : output.explanationStatus === 'unavailable' ? ui.unavailable : undefined;
  return (
    <div className="div-classic-advice">
      <section className="div-classic-advice-local" aria-label={t('div_cs_ai_local_badge')}>
        <DividendAdvisorMarkdown language={i18n.language}>{output.localMarkdown}</DividendAdvisorMarkdown>
      </section>
      {output.modelMarkdown && (
        <details className="div-classic-advice-explanation" open>
          <summary>{t('div_cs_ai_model_badge')}</summary>
          {targetLabel && <p className="div-classic-advice-question">{targetLabel}</p>}
          <DividendAdvisorMarkdown language={i18n.language}>{output.modelMarkdown}</DividendAdvisorMarkdown>
        </details>
      )}
      {notice && <p className="div-muted" role="status">{notice}</p>}
    </div>
  );
}
