# Automatic dividend quotes and compact settings

All browser checks use an isolated synthetic IndexedDB ledger. The screenshots contain no personal financial history, credentials or live portfolio balances.

## Quotes

- The page refreshes saved mainland stock and listed ETF/LOF/REIT quotes on entry, then once a minute while visible, and on foreground/focus/online events. Android foreground/background events use the existing native lifecycle bridge. Leaving the page removes timers and listeners.
- Adjacent wake-up events coalesce and overlapping requests are skipped. New target changes queue a fresh request. Quotes are deduplicated and requested in batches of at most 100 symbols; an unavailable batch or missing symbol does not discard the other successes.
- Shanghai funds use `sh`, Shenzhen ETF/LOF codes use `sz`, and Beijing equities use `bj`. Quotes validate the returned code, positive price, calendar/clock timestamp and integer precision. Fund prices persist in millionths of CNY; stock prices retain the existing cents schema.
- Source timestamps remain distinct from fetch timestamps. Closed markets show the last traded quote. Missing/malformed/network failures retain the dated cache and set a per-target failure flag, cleared on successful recovery.
- Automatic fund quotes are separate from manual price/high/index-yield references. Fresh quotes cannot redate those observations. Old/failed quote data or old manual references cannot produce a current fund entry signal.
- Transactional field updates preserve concurrent budgets, allocations, notes, code changes, deletions and actual ledger entries. Saving an old editor preserves the current quote cache. Changing a fund code clears its previous quote.
- Off-exchange and name-only funds use manual references, with an explanation in the UI. JSON/Excel backups preserve automatic quotes, their precision, failure flags and manual references.
- A live Tencent response was checked for `601398`, `512890`, `563020`, `159581` and `161716`. Those checks establish provider reachability and response format, separate from the mocked lifecycle browser checks and from native-device coverage.

## Settings

- Colour palettes, base currency/rates/gold, categories, common currencies and automatic snapshots use closed native disclosure menus. Summaries show the current selection/count/status. Only one of these menus opens at a time on browsers supporting grouped disclosures.
- Vision configuration uses a compact accessible toggle; its long form/status/help are inside the menu. The existing direct configuration entry still expands and scrolls to the form.
- Menu interaction, keyboard opening, all eleven colour previews, palette persistence after reload, adding/deleting a synthetic category, adding/removing a currency and vision-form expansion were checked. Collapsing does not reset edits or change ledger data.

## Verified

- 205 automated tests pass, including venue/precision/time validation, independent failures, batching, edit/request races, deletion safety, stale reference signals, backup round-trips and existing app behaviour.
- ESLint, TypeScript, production build and Android/iOS asset synchronization pass.
- Twenty browser behaviour checks and 24 layout checks pass: Chinese/English × normal/large fonts × 320px/390px, across closed settings, open palette menus and fund pages. There is no horizontal overflow or clipped form control, and no browser runtime error.
- The synthetic ledger's record count, amount and stock DPS override remain unchanged by quote/view operations. Evidence is in [browser-validation.json](browser-validation.json) and the adjacent PNGs.
- No physical Android device was connected. Native build/signature/package/update-parser verification is a separate release gate; actual device cover-install/data retention remains unverified.
