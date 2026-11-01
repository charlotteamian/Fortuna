/** Shared cancellation boundary for web requests, native HTTP and PDF work.
 * Native HTTP cannot physically abort: its promise is detached on cancellation,
 * and every subsequent parse/cache write must pass the same boundary. */
export interface DividendRequestControl {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  beforeWrite?: () => Promise<void>;
}

export function assertDividendRequestCurrent(control: DividendRequestControl = {}) {
  control.signal?.throwIfAborted();
  if (control.isCurrent && !control.isCurrent()) throw new DOMException('Superseded dividend request', 'AbortError');
}

export async function awaitDividendRequest<T>(task: Promise<T>, control: DividendRequestControl = {}): Promise<T> {
  // Attach handlers even when the request was cancelled just before this call.
  // A detached native promise must never become an unhandled rejection.
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(control.signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    if (control.signal?.aborted) abort();
    else control.signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const value = await Promise.race([task, stopped]);
    assertDividendRequestCurrent(control);
    return value;
  } finally {
    if (abort) control.signal?.removeEventListener('abort', abort);
  }
}

export function dividendRequestSignal(control: DividendRequestControl, timeoutMs: number) {
  assertDividendRequestCurrent(control);
  const timeout = AbortSignal.timeout(timeoutMs);
  return control.signal ? AbortSignal.any([control.signal, timeout]) : timeout;
}

export async function beforeDividendCacheWrite(control: DividendRequestControl = {}) {
  assertDividendRequestCurrent(control);
  await control.beforeWrite?.();
  assertDividendRequestCurrent(control);
}

// All existing refresh entry points share these tickets. An older response
// cannot overwrite a cache merely because it arrived after a newer request.
const latest = new Map<string, symbol>();
export function claimDividendRequest(key: string) {
  const ticket = Symbol(key); latest.set(key, ticket);
  return () => latest.get(key) === ticket;
}

const foregroundChecks = new Set<symbol>();
export function suspendDividendBackgroundRefresh() {
  const token = Symbol('daily-check'); foregroundChecks.add(token);
  return () => { foregroundChecks.delete(token); };
}
export function dividendBackgroundRefreshPaused() { return foregroundChecks.size > 0; }
