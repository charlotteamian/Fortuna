import type { Account, Holding, PlanItem, PlanTarget } from '../db';

/** Only missing database records are obsolete; archived/excluded records are still real. */
export function repairPlanReferences(items: PlanItem[], targets: PlanTarget[], accounts: Account[], holdings: Holding[]) {
  const accountIds = new Set(accounts.map(account => account.id));
  const holdingIds = new Set(holdings.filter(holding => accountIds.has(holding.accountId)).map(holding => holding.id));
  const validRef = (ref: string) => ref.startsWith('h:') ? holdingIds.has(ref.slice(2))
    : /^[ac]:/.test(ref) ? accountIds.has(ref.slice(2)) : false;
  const validScope = (scope: string) => scope.startsWith('hold:') ? holdingIds.has(scope.slice(5))
    : scope.startsWith('acct:') || scope.startsWith('cash:') ? accountIds.has(scope.slice(5)) : true;
  const fixedItems = items.map(item => ({ ...item,
    categories: [...new Set(item.categories.filter(validScope))],
    ...(item.allocations ? { allocations: item.allocations.filter(allocation => validRef(allocation.refKey)) } : {}),
  }));
  const fixedTargets = targets.map(target => {
    const refs = target.refKeys ?? (target.refKey ? [target.refKey] : []);
    return { ...target, refKeys: [...new Set(refs.filter(validRef))],
      ...(target.refKey && !validRef(target.refKey) ? { refKey: undefined } : {}),
      ...(target.allocations ? { allocations: target.allocations.filter(allocation => validRef(allocation.refKey)) } : {}),
    };
  });
  return {
    items: fixedItems, targets: fixedTargets,
    changedItems: fixedItems.filter((item, index) => JSON.stringify(item) !== JSON.stringify(items[index])),
    changedTargets: fixedTargets.filter((target, index) => JSON.stringify(target) !== JSON.stringify(targets[index])),
  };
}
