import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAccountsByArchive } from '../src/lib/accountArchive';

type AccountLike = {
  id: string;
  name: string;
  archivedAt?: number | null;
};

test('splitAccountsByArchive keeps active accounts separate from archived accounts', () => {
  const accounts: AccountLike[] = [
    { id: 'cash', name: 'Cash' },
    { id: 'closed-broker', name: 'Closed Broker', archivedAt: 1710000000000 },
    { id: 'loan', name: 'Loan', archivedAt: null },
  ];

  const result = splitAccountsByArchive(accounts);

  assert.deepEqual(result.active.map(account => account.id), ['cash', 'loan']);
  assert.deepEqual(result.archived.map(account => account.id), ['closed-broker']);
});

test('splitAccountsByArchive sorts archived accounts by newest archivedAt first', () => {
  const accounts: AccountLike[] = [
    { id: 'old', name: 'Old', archivedAt: 1700000000000 },
    { id: 'active', name: 'Active' },
    { id: 'new', name: 'New', archivedAt: 1720000000000 },
  ];

  const result = splitAccountsByArchive(accounts);

  assert.deepEqual(result.archived.map(account => account.id), ['new', 'old']);
});
