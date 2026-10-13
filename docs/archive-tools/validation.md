# Archive tools and colour palettes

All screenshots and browser checks use an isolated synthetic IndexedDB ledger, with external network requests blocked. They do not contain a user's financial history.

## Behaviour

- Archived securities support name/code search, A-share/US/HK/Other market filtering, inclusive start/end dates, and ascending/descending date, name and realised P&L ordering.
- Market labels use the existing import aliases. An explicit Other label stays Other; US option contracts belong to the US market.
- Holding dates mean the latest ledger record, including a position or balance calibration. They are not creation timestamps. Undated histories appear without a date filter and sort last in either date direction.
- Time filters select holdings, not individual fills. Expanded cards retain the complete transaction history. The result total is the sum of the displayed holdings' lifetime realised P&L, rounded to minor units per holding, in the account currency.
- Unit-based funds use the same search, date, name and P&L tools. Deposits, wealth products, receivables and other balance products support search and date/name ordering. Balance products do not acquire a fabricated P&L measure.
- Manually archived accounts across other asset/liability categories gain name/institution/product-code search, category filtering and archive-date/name ordering. Existing manual archive/restore behaviour and totals are retained.
- Filters are local view state. Search, sorting, filtering and colour changes do not edit transactions, quantities, costs or archived status.
- Six new colour pairs extend the original five to eleven: Violet/Champagne, Coral/Cyan, Indigo/Peach, Mint/Lilac, Gold/Slate and Rose/Ice. Theme IDs persist through the existing transactional settings path. Preview colours follow the selected appearance.

## Verification

- 196 automated tests pass, including search normalisation, inclusive/open date boundaries, combined filters, invalid ranges, natural name order, negative/zero/positive P&L, deterministic ties, market aliases and missing dates.
- New palette foregrounds have at least 4.5:1 contrast against card surfaces and their tinted surfaces in both light and dark modes. Original theme IDs and colours remain compatible.
- ESLint, TypeScript and production build pass.
- Browser checks cover six sorting directions, name/code search (including full-width codes and case), market/date combinations, reset and empty states, unmodified full transaction details, fund/deposit/account archives, all palette selections, reload persistence, CSS colours and amount masking.
- Eight layout cases cover 320px/390px, Chinese/English, light/dark, normal/large fonts, account archive controls and colour selection. No horizontal overflow or clipped form controls; no browser runtime errors.
- The browser run confirms account/holding/transaction counts and a selected trade price remain unchanged after all view operations.
- Formal Android signature/package/version/digest/resource and update-parser checks are recorded after the GitHub build. No physical Android device was connected; physical cover-install/data retention remains unverified.

See [browser-validation.json](browser-validation.json) and the adjacent PNGs for the synthetic browser evidence.
