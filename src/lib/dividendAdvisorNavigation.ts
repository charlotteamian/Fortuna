export const DIVIDEND_AI_SETTINGS_REQUEST_EVENT = 'fortuna:dividend-ai-settings-request';
export const DIVIDEND_AI_CONFIG_CHANGED_EVENT = 'fortuna:dividend-ai-config-changed';
export const DIVIDEND_ADVISOR_READER_HASH = '#/dividend/advice';

export function dividendAdvisorReaderUrl(href: string): string {
  const url = new URL(href);
  url.hash = DIVIDEND_ADVISOR_READER_HASH;
  return url.href;
}

/** An edge gesture must be clearly horizontal so ordinary article scrolling stays safe. */
export function isDividendAdvisorBackSwipe(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  const horizontal = end.x - start.x;
  const vertical = Math.abs(end.y - start.y);
  return start.x <= 48 && horizontal >= 80 && vertical <= 60 && horizontal > vertical * 2;
}
