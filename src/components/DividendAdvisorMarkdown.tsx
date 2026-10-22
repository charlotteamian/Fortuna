import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { humanizeDividendPricingIssues } from '../lib/dividendPricing.ts';

export default function DividendAdvisorMarkdown({ children, language = 'en' }: { children: string; language?: string }) {
  return <div className="div-advisor-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img', 'input']}
    components={{
      a: ({ children: label, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>,
      table: ({ children: rows }) => <div className="div-advisor-markdown-table"><table>{rows}</table></div>,
    }}>{humanizeDividendPricingIssues(children, language)}</Markdown></div>;
}
