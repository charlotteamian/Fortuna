import { dividendDailyCoverage, dividendDailyItem, sortDividendDailyItems, type DividendDailyCheck, type DividendDailyItem, type DividendDailySource } from '../lib/dividendDailyCheck';
import { loadDividendWorkbenchReadOnly } from './dividendService';
import { loadDividendFundPositions, prepareDividendAdvisorContext, type DividendAdvisorRefreshEvent } from './dividendAdvisorContextService';
import { loadDividendCheckSummaries } from './dividendCheckSummaryService';
import { loadDividendDailyAdvicePlanKey, loadDividendDailyCheckInputKey } from './dividendDailyAdviceScopeService';
import { loadDividendDailyChecks, saveDividendDailyCheck } from './dividendDailyAdviceService';
import { assertDividendRequestCurrent, awaitDividendRequest, suspendDividendBackgroundRefresh } from './dividendRequestControl';

export const DIVIDEND_DAILY_CHECK_TIMEOUT_MS = 90_000;
export interface DividendDailyCheckSnapshot { inputKey: string; planKey: string; items: DividendDailyItem[] }
export async function loadDividendDailyCheckSnapshot(): Promise<DividendDailyCheckSnapshot> {
  const inputKey = await loadDividendDailyCheckInputKey();
  const data = await loadDividendWorkbenchReadOnly();
  const fundPositions = await loadDividendFundPositions(data.fundPlan.funds);
  const checks = await loadDividendCheckSummaries(data, { fundPositions });
  const planKey = await loadDividendDailyAdvicePlanKey(data, checks);
  if (inputKey !== await loadDividendDailyCheckInputKey()) throw new Error('DIVIDEND_CHECK_INPUTS_CHANGED');
  return { inputKey, planKey, items: sortDividendDailyItems([...Object.values(checks.stocks), ...Object.values(checks.funds)].map(check => dividendDailyItem(check))) };
}

interface Dependencies {
  load: () => Promise<DividendDailyCheckSnapshot>;
  inputKey: () => Promise<string>;
  refresh: typeof prepareDividendAdvisorContext;
  save: typeof saveDividendDailyCheck;
  owner?: () => Promise<string | undefined>;
}
interface RunOptions {
  signal?: AbortSignal; timeoutMs?: number; previous?: DividendDailyCheck; retryKeys?: string[];
  onUpdate?: (value: DividendDailyCheck) => void;
}

function initialSources(items: DividendDailyItem[]): DividendDailySource[] {
  return items.flatMap(item => [
    { id: `${item.key}:quote`, itemKey: item.key, stage: 'quotes' as const, provider: 'Tencent', status: 'pending' as const },
    ...item.kind === 'stock' ? ['disclosure', 'schedule', 'research', 'official'].map(kind => ({ id: `${item.key}:${kind}`, itemKey: item.key,
      stage: 'evidence' as const, provider: kind === 'official' ? 'CNINFO' : 'Eastmoney', status: 'pending' as const }))
      : [{ id: `${item.key}:reference`, itemKey: item.key, stage: 'evidence' as const, provider: 'manual', status: 'pending' as const }],
    { id: `${item.key}:plan`, itemKey: item.key, stage: 'plans' as const, provider: 'local', status: 'pending' as const },
  ]);
}

/** One active batch per runner. Repeated clicks join it; a new visit/new runner
 * claims the cache record, so detached older writes cannot replace its result. */
export function createDividendDailyCheckRunner(deps: Dependencies) {
  let active: { controller: AbortController; promise: Promise<DividendDailyCheck>; generation: number } | undefined;
  let generation = 0;
  const run = (options: RunOptions = {}): Promise<DividendDailyCheck> => {
    if (active) return active.promise;
    const releaseBackgroundRefresh = suspendDividendBackgroundRefresh();
    const controller = new AbortController(), ownGeneration = ++generation;
    const startedAt = Date.now(), batchId = crypto.randomUUID();
    const timeoutMs = Math.max(1, Math.min(180_000, options.timeoutMs ?? DIVIDEND_DAILY_CHECK_TIMEOUT_MS));
    const timer = setTimeout(() => controller.abort(new DOMException('Daily check deadline', 'TimeoutError')), timeoutMs);
    const forwardAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort(); else options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const current = () => generation === ownGeneration;
    const control = { signal: controller.signal, isCurrent: current };
    const execute = async (): Promise<DividendDailyCheck> => {
      let value: DividendDailyCheck = { version: 1, batchId, revision: 0, startedAt, deadlineAt: startedAt + timeoutMs, status: 'running', stage: 'quotes',
        inputKey: '', planKey: '', items: [], sources: [], checkedKeys: [], errors: [], retryOf: options.previous?.batchId, retryKeys: options.retryKeys };
      let claimed = false, queue = Promise.resolve();
      const publish = async (claim = false, terminal = false) => {
        if (!current()) return;
        value = { ...value, revision: value.revision + 1 };
        options.onUpdate?.(structuredClone(value));
        try {
          const saved = await awaitDividendRequest(deps.save(value, { claim, isCurrent: current }), terminal
            ? { signal: AbortSignal.timeout(1000), isCurrent: current } : control);
          if (claim) claimed = saved;
          else if (claimed && !saved) controller.abort(new DOMException('Newer daily check', 'AbortError'));
        } catch {
          if (!terminal && controller.signal.aborted) return;
          if (!value.errors.includes('storage_failed')) value.errors.push('storage_failed');
          if (current()) options.onUpdate?.(structuredClone(value));
        }
      };
      const guardInputs = async () => {
        assertDividendRequestCurrent(control);
        const inputKey = await awaitDividendRequest(deps.inputKey(), control);
        if (inputKey !== value.inputKey) {
          controller.abort(new Error('DIVIDEND_CHECK_INPUTS_CHANGED'));
          assertDividendRequestCurrent(control);
        }
        if (claimed && deps.owner && await awaitDividendRequest(deps.owner(), control) !== batchId) {
          controller.abort(new DOMException('Newer daily check', 'AbortError'));
          assertDividendRequestCurrent(control);
        }
      };
      const updateItems = async (checkedKeys: string[] = []) => {
        const snapshot = await awaitDividendRequest(deps.load(), control);
        if (snapshot.inputKey !== value.inputKey) {
          controller.abort(new Error('DIVIDEND_CHECK_INPUTS_CHANGED')); assertDividendRequestCurrent(control);
        }
        const old = new Map(value.items.map(item => [item.key, item]));
        const checked = new Set(checkedKeys);
        value = { ...value, planKey: snapshot.planKey, items: sortDividendDailyItems(snapshot.items.map(item => {
          const previous = old.get(item.key), isChecked = checked.has(item.key);
          return { ...item, checkedAt: isChecked ? Date.now() : previous?.checkedAt,
            stale: isChecked ? false : previous?.checkedAt !== undefined && (previous.stale || item.fingerprint !== previous.fingerprint) };
        })) };
        value.checkedKeys = value.items.filter(item => item.checkedAt !== undefined && !item.stale).map(item => item.key);
      };
      const onEvent = (event: DividendAdvisorRefreshEvent): Promise<void> => {
        queue = queue.then(async () => {
          assertDividendRequestCurrent(control);
          await guardInputs();
          value.stage = event.stage;
          if (event.source) value.sources = [...value.sources.filter(source => source.id !== event.source!.id), event.source];
          if (event.checkedKeys) {
            await updateItems(event.checkedKeys);
            for (const key of event.checkedKeys) value.sources = value.sources.map(source => source.id === `${key}:plan` ? { ...source, status: 'success', attemptedAt: Date.now() } : source);
          } else if (!event.source || event.source.id.endsWith(':official')) await updateItems();
          await publish();
        });
        return queue;
      };
      try {
        const snapshot = await awaitDividendRequest(deps.load(), control);
        value = { ...value, inputKey: snapshot.inputKey, planKey: snapshot.planKey, items: snapshot.items };
        const retry = options.retryKeys && new Set(options.retryKeys);
        if (retry) {
          const previous = options.previous;
          if (!previous || !retry.size || [...retry].some(key => !snapshot.items.some(item => item.key === key)
            || !previous.sources.some(source => source.itemKey === key && ['failed', 'deferred'].includes(source.status)))) throw new Error('INVALID_DAILY_RETRY');
          const prior = new Map(previous.items.map(item => [item.key, item]));
          value.items = snapshot.items.map(item => ({ ...item, checkedAt: retry.has(item.key) ? undefined : prior.get(item.key)?.checkedAt,
            stale: !retry.has(item.key) && (previous.inputKey !== snapshot.inputKey || prior.get(item.key)?.fingerprint !== item.fingerprint) }));
          value.sources = [...previous.sources.filter(source => !retry.has(source.itemKey) && snapshot.items.some(item => item.key === source.itemKey) || source.itemKey === 'market'),
            ...initialSources(value.items.filter(item => retry.has(item.key)))];
          value.checkedKeys = value.items.filter(item => item.checkedAt !== undefined && !item.stale).map(item => item.key);
        } else value.sources = initialSources(snapshot.items);
        await publish(true);
        await guardInputs();
        await awaitDividendRequest(deps.refresh(() => undefined, { ...control, beforeWrite: guardInputs, itemKeys: options.retryKeys, onEvent }), control);
        await queue;
        await guardInputs();
        await updateItems();
        const coverage = dividendDailyCoverage(value.sources);
        value.status = coverage.failed || coverage.deferred || coverage.pending || value.items.some(item => item.stale) || value.errors.length ? 'partial' : 'completed';
        value.stage = 'result';
      } catch (cause) {
        const reason = controller.signal.reason ?? cause;
        value.status = reason instanceof Error && reason.message === 'DIVIDEND_CHECK_INPUTS_CHANGED' ? 'changed'
          : reason instanceof DOMException && reason.name === 'TimeoutError' ? 'timed_out' : controller.signal.aborted ? 'cancelled' : 'partial';
        if (!controller.signal.aborted) controller.abort(cause);
        if (value.status === 'changed') { value.items = value.items.map(item => ({ ...item, stale: true })); value.checkedKeys = []; }
        if (!['cancelled', 'timed_out', 'changed'].includes(value.status)) value.errors.push(cause instanceof Error && cause.message === 'INVALID_DAILY_RETRY' ? 'invalid_retry' : 'check_failed');
        value.sources = value.sources.map(source => source.status === 'pending' ? { ...source, status: 'deferred', detail: value.status } : source);
      } finally {
        value.finishedAt = Date.now();
        // Terminal persistence is ordered after earlier progress writes. Never
        // wait on a source promise that ignored cancellation.
        await queue.catch(() => undefined);
        await publish(!claimed, true);
        clearTimeout(timer); options.signal?.removeEventListener('abort', forwardAbort);
      }
      return structuredClone(value);
    };
    const promise = execute().finally(() => { releaseBackgroundRefresh(); if (active?.generation === ownGeneration) active = undefined; });
    active = { controller, promise, generation: ownGeneration };
    return promise;
  };
  return { run, cancel: () => active?.controller.abort(new DOMException('User cancelled', 'AbortError')), isRunning: () => !!active };
}

export const dividendDailyCheckRunner = createDividendDailyCheckRunner({ load: loadDividendDailyCheckSnapshot,
  inputKey: loadDividendDailyCheckInputKey, refresh: prepareDividendAdvisorContext, save: saveDividendDailyCheck,
  owner: async () => (await loadDividendDailyChecks()).current?.batchId });
