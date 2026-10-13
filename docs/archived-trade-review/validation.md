# Archived trade review and visual API settings

Validated on 2026-10-13 with an isolated synthetic ledger. No personal holdings or real API credentials were used.

## Changes

- Transaction rows show the full date, direction, quoted price, quantity, currency and fill value on separate lines. Recorded notes and broker fill references remain visible.
- Archived securities show recorded purchases and sales, quantities, weighted average fill prices, moving-average realised P&L and the date range. Each fill value is rounded to integer cents before aggregation, matching its detail row. Calibration anchors are excluded from trade totals.
- Newest/oldest ordering retains the ledger's same-day fill order. Small edit/delete icons replace large action boxes, and deletion opens a confirmation with the selected record.
- The archived card header shows historical realised P&L and the trade period. Full archived names remain readable.
- A distinct card at the top of Settings exposes visual API configuration. It displays the saved provider/model separately from unsaved form changes. The screenshot-import shortcut opens this same Settings screen while retaining its pending preview.

## Verification

- `npm test`: 184 tests passed, including five trade-summary cases covering round trips, weighted prices, fractional fills, fill-level cent rounding, option multipliers, empty history and calibration-only history.
- ESLint, TypeScript, production build and `git diff --check` passed.
- `browser-check.json`: Chinese light-mode 390px / 320px, Chinese large-font 320px, and English dark-mode large-font 320px show no clipped transaction fields or horizontal overflow. API settings also fit at 320px in Chinese and English large-font mode. Screenshots are in this directory.
- Six synthetic fills reconcile to CNY 2,888.80 bought, CNY 2,621.20 sold, 900 shares each side, and CNY -267.60 realised P&L.
- Editing a fill refreshes its detail, totals and P&L while preserving its note and reference. Cancelled deletion preserves data; confirmed deletion recalculates the position and archive membership.
- Calibration and balance-mode rows display their correct fields. Amount privacy masks transaction prices, quantities, values and summary amounts.
- Settings saves and restores API configuration after reload. A mocked screenshot preview survives Settings navigation and return without being committed to the ledger.

## Validation boundaries

Fill totals exclude fees, taxes and dividends. P&L retains the existing moving-average ledger semantics, including imported cost calibrations. The API flow uses a mocked response and does not establish actual provider recognition accuracy. No physical Android device was connected; device installation and data retention were not retested.

The signed release, package identity, versions, certificate, SHA-256, bundled resources and update parser are verified after the GitHub workflow publishes the APK.
