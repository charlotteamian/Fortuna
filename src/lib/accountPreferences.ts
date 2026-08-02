export interface AccountPreferencesLike {
  includeInTotals?: boolean;
  hidden?: boolean;
}

/** Legacy accounts default to participating in totals. */
export function isAccountIncludedInTotals(account: AccountPreferencesLike): boolean {
  return account.includeInTotals !== false;
}

/** Hiding changes presentation only; it never changes whether an account participates in totals. */
export function isAccountHidden(account: AccountPreferencesLike): boolean {
  return account.hidden === true;
}
