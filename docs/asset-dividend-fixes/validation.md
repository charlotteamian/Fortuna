# Asset detail scrolling and dividend list imports

Validated on 2026-10-05 using isolated synthetic IndexedDB data. No user ledger was imported or modified for browser verification.

## Changes

- Account detail remains mounted while visiting holding-recognition API settings. Its host now has an explicit height, and the flex content has `min-height: 0`, restoring the internal scroll area for all account categories.
- Removing a dividend stock offers proportional redistribution or leaving its released allocation unused. Confirmation previews all remaining stocks, including hidden stocks, with old/new weights and allocation amounts. Existing unused allocation and zero-weight stocks are preserved during deletion.
- Allocate unused budget scales existing positive weights to 100%. Both operations use largest-remainder rounding to retain exact integer basis-point totals. After redistribution the page shows the actual denominator, target total and optional per-stock changes. Budget amounts remain integer minor units and respect amount visibility.
- Stock list import accepts XLSX/XLS/CSV/TSV or pasted CSV/TSV with required code, name and independent plan weight (%) columns; group and notes are optional. Export list / template produces an editable workbook containing current stocks and weights.
- Preview supports individual selection, select-all and cancellation. Invalid or duplicate rows are excluded with row-specific explanations. Final weights are checked against 100%, including unselected and hidden stocks, before a transaction commits.
- Matching stock codes update the supplied plan fields while retaining custom buy/sell grids, manual dividends, share mode, quantities and cached market data. Blank optional cells preserve existing group/notes; omitted stocks remain unchanged. New stocks link to existing holdings and use the established 200-share grid step for STAR Market codes and 100 otherwise.

## Automated verification

- `npm test`: 172 tests passed, including parser format/percentage cases, formula and duplicate rejection, literal text notes, selected updates, metadata preservation, over-budget rejection, transaction rollback, optional deletion redistribution and exact rounded allocation.
- `npm run lint`: passed.
- `npm run build`: passed (TypeScript + production Vite build).
- `npx cap sync android`: passed, final web resources synchronised.
- `git diff --check`: passed.

## Browser verification

Headless installed Chrome with mobile touch emulation at 390×844 and 320×844. Requests outside the local Vite server were blocked so live quotes could not affect deterministic synthetic checks.

- Before the fix, all 17 synthetic account scenarios (16 built-in asset/liability categories plus a non-portfolio stock account) remained at `scrollTop = 0`: their content had expanded past the 844px root and was clipped.
- After the fix, all 17 scenarios could scroll to the bottom at both widths. Large-font rendering and actual CDP touch gestures also passed.
- Opening API settings from an import draft and returning preserved the date and scroll position; closing the modal left the account fully scrollable.
- Dividend checks covered proportional allocation, hidden/zero-weight stocks, preview/result equality, deletion with/without redistribution, post-allocation calculation explanation, exported XLSX round-trip, UTF-8 CSV, unequal imported weights, individual selection, valid rows alongside invalid rows, metadata preservation, over-budget blocking, amount privacy and reload persistence.
- Both widths had no page exceptions or page-wide horizontal overflow.

Evidence: `scroll-*.json`, `dividend-*.json`, and the four PNGs in this directory. Browser scripts used during this run are `/tmp/fortuna-scroll-check.cjs` and `/tmp/fortuna-dividend-check.cjs`; their absolute local runtime paths are intentionally not part of the app source.

## Limits

Browser mobile emulation does not establish physical Android WebView behaviour. No physical-device installation or signed APK release was performed in this change; the request was to fix the source and push it to GitHub.
