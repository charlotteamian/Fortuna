export const PORTABLE_SNAPSHOT_REQUEST_EVENT = 'fortuna:portable-snapshot-requested';

export function requestPortableSnapshot(reason: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PORTABLE_SNAPSHOT_REQUEST_EVENT, { detail: { reason } }));
}
