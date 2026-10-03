# Fortuna 1.4.0 validation

Scope: integrate the user-supplied dividend grid workbook into the React/Capacitor app, repair plan references, preserve the established release identity.

## Data and calculations

- Initial groups and relative weights follow the supplied workbook; no fixed total budget or stale sample dividend/quote data is imported.
- New amounts persist as integer CNY cents; per-share dividend data preserves six decimal places as integer millionths of CNY.
- Implemented cash dividends use a trailing 12-calendar-month ex-date window, convert per-10-share payouts, deduplicate by report period and ex-date, and exclude future/unimplemented plans.
- Linked quantities use active CNY stock portfolio accounts and unit-mode mainland equities; sales reduce shares. Archived accounts, OTC funds, options, foreign markets and future transactions are excluded. Hidden/excluded-from-totals stock accounts remain real holdings.
- Buy-grid shares sum each incremental allocation divided by its level price before lot rounding. Sell simulations use current holdings as the base. User price overrides have derived yields.
- Failed requests retain dated cache and flags. Manual dividend/share settings survive refresh. No demo fallback.
- Dividend histories: Eastmoney datacenter. Quotes and adjusted daily history: Tencent. The original Eastmoney daily-history endpoint returned an empty response during validation; Tencent returned 250 rows.
- The source field DIVIDENT_RATIO is not treated as a payout ratio. BVPS/profit growth are labelled with the dividend record's report period.

## Verification

- Automated coverage: plan cleanup and excluded-account labels; full-year dividend boundaries, leap date, pending/future/duplicate payments; quotes; proportional budgets; grids; equity/fund share linking; JSON/Excel restore; manual overrides and failed/recovered market refresh; daily indicator calculations and Tencent adapter.
- Browser checks completed before interruption: 390 × 844 and 320 × 740 viewports, no horizontal overflow at 320px, editable budget, single-stock edit dialog, live refresh of all 19 default symbols, grid details, Settings/back navigation and amount masking.
- Synthetic example: CNY 320,000 total budget allocated CNY 16,000 to the 5% ICBC entry. A 2,000-share test holding linked automatically; DPS CNY 0.3103 gave CNY 620.60 estimated annual gross dividends. These are QA fixtures, not the user's holdings or a current recommendation.
- Last added trend section was verified through parsers and the live source. Its final browser interaction was unavailable after the browser disconnected; no phone-install claim is made.
- Tests, lint, production build and Capacitor sync are required before tagging. CI builds and verifies the release signer. Downloaded release will be compared against the prior APK, package/version metadata and locally built web assets.

## Release requirements

- Version 1.4.0 / Android versionCode 8, package com.fortuna.wealthtracker.
- Expected signer SHA-256: b6898c38efabded0a7a2826ff1b83c5191b3d3be7f0723201984ecd0fc8cf62c.
- Stable GitHub release asset: Fortuna-1.4.0-release.apk.
- Unrelated pre-existing plan screenshots are not part of this change.
