import { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION, db, initializeSettings } from '../db';
import { AUTOMATIC_SNAPSHOT_FILE, buildPortableSnapshot } from '../lib/portableSnapshot';
import { getAccountsWithLatest } from './assetService';
import { getPlanStatus } from './planService';
import {
  choosePortableSnapshotDirectory,
  clearPortableSnapshotDirectory,
  getPortableSnapshotStatus,
  writePortableSnapshot,
  type PortableSnapshotStatus,
} from '../native/portableSnapshot';

export interface PortableSnapshotResult {
  written: boolean;
  status: PortableSnapshotStatus;
  writtenAt?: number;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let hasPendingChanges = false;
let writeChain: Promise<PortableSnapshotResult> = Promise.resolve({
  written: false,
  status: { supported: false, configured: false },
});

async function performSnapshotWrite(trigger: string): Promise<PortableSnapshotResult> {
  const status = await getPortableSnapshotStatus();
  if (!status.supported || !status.configured) {
    await db.settings.update('main', { automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION });
    return { written: false, status };
  }

  const [settings, accountData, records, holdings, transactions, exchangeRates, planStatus] = await Promise.all([
    initializeSettings(),
    getAccountsWithLatest(),
    db.records.toArray(),
    db.holdings.toArray(),
    db.holdingTxns.toArray(),
    db.exchangeRates.toArray(),
    getPlanStatus(),
  ]);
  const snapshot = buildPortableSnapshot({
    accounts: accountData.accounts,
    records,
    holdings,
    transactions,
    exchangeRates,
    planStatus,
    settings,
    trigger,
  });
  const result = await writePortableSnapshot(AUTOMATIC_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  await db.settings.update('main', { automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION });
  return {
    written: true,
    writtenAt: result.writtenAt,
    status: { ...status, lastWriteAt: result.writtenAt },
  };
}

function enqueueSnapshotWrite(trigger: string): Promise<PortableSnapshotResult> {
  const run = async () => {
    const result = await performSnapshotWrite(trigger);
    if (result.written || !result.status.supported || !result.status.configured) hasPendingChanges = false;
    return result;
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

export function schedulePortableSnapshot(trigger: string, delayMs = 700): void {
  hasPendingChanges = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void enqueueSnapshotWrite(trigger).catch(error => console.warn('Automatic snapshot write failed', error));
  }, delayMs);
}

export async function flushPortableSnapshot(trigger: string): Promise<PortableSnapshotResult> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const force = trigger === 'manual-sync' || trigger === 'directory-configured';
  if (!hasPendingChanges && !force) {
    return { written: false, status: await getPortableSnapshotStatus() };
  }
  return enqueueSnapshotWrite(trigger);
}

export async function configurePortableSnapshot(): Promise<PortableSnapshotResult> {
  const status = await choosePortableSnapshotDirectory();
  if (!status.configured) return { written: false, status };
  return flushPortableSnapshot('directory-configured');
}

export async function disconnectPortableSnapshot(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  hasPendingChanges = false;
  await clearPortableSnapshotDirectory();
}

export { getPortableSnapshotStatus, AUTOMATIC_SNAPSHOT_FILE };
