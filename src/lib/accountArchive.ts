export interface ArchivableAccount {
  archivedAt?: number | null;
}

export function isArchivedAccount(account: ArchivableAccount): boolean {
  return typeof account.archivedAt === 'number';
}

export function splitAccountsByArchive<T extends ArchivableAccount>(accounts: T[]): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];

  for (const account of accounts) {
    if (isArchivedAccount(account)) archived.push(account);
    else active.push(account);
  }

  archived.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  return { active, archived };
}
