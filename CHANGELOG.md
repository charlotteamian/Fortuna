# Changelog

All notable user-facing changes are documented here.

## [1.2.0] - 2026-07-28

### Onboarding and documentation

- Added a first-install walkthrough with privacy, account-model, amount-visibility, and backup guidance.
- Rebuilt the in-app user guide around the app's complete feature set and everyday workflows.
- Replaced private workflow terminology with general-purpose descriptions throughout the product.

### Accounts, holdings, and planning

- Added portfolio accounts for stocks, funds, deposits, bonds, wealth products, and receivables.
- Added archived accounts and sold-out archived holdings/products, with collapsed detail sections.
- Added US option contract entry and multiplier-aware valuation.
- Added exact resource allocation across top-level plans and subcategories with proportional over-allocation handling.
- Added cumulative P&L, diluted cost, realized cost basis, and correct sold-out return calculations.

### Privacy and portability

- Replaced workflow-specific automatic exports with an optional, portable, user-selected JSON snapshot.
- Added complete Excel backup/restore coverage for accounts, settings, holdings, transactions, plans, targets, and cached rates.
- Added a deterministic synthetic JSON/Excel demo dataset for public screenshots and evaluation.

### Performance and accessibility

- Made startup non-blocking when background refresh or snapshot migration is pending.
- Improved large-text and narrow-screen layouts across summaries, forms, records, modals, and account details.
- Added account-detail amount masking controls and collapsible value snapshots.

### Fixes

- Fixed archived holdings visibility, portfolio math, rate-response parsing, local-date boundaries, balance-flow history, and snapshot schema migration.
- Fixed Android splash/background behavior and generalized the native snapshot integration.

## [1.1.0] - 2026-07-27

- Public preview with local-first account tracking, charts, allocation plans, Excel backup, and Android packaging.
