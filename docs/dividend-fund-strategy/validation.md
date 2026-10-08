# Dividend fund strategy and archived names

Validated on 2026-10-08. Browser checks used isolated synthetic data at `http://127.0.0.1:5176/`; no user ledger was imported or changed.

## Behaviour

- Archived cards wrap the complete holding name on its own row and omit the code badge. Active holdings retain their established layout.
- The dividend page has a top-level stock/fund selector, persisted in Dexie settings. The stock budget and plans remain independent of the fund strategy.
- Fund entries accept a name, optional six-digit code, index type, weight and note. Plan edits, funds and display preferences update transactionally using the latest settings, preserving concurrent edits.
- Weights divide the dividend-fund sleeve. In 70:30 mode, 70% of the overall strategy budget is the fund sleeve and 30% is a bond reserve. The reserve is a plan, not an actual bond holding. A largest-remainder calculation accounts for every cent, including unassigned funds.
- Deleting a fund leaves its released allocation unassigned. Total fund weight cannot exceed 100%. Fund plans do not affect actual asset totals.
- Supported approaches are long-term holding, annual 70:30 rebalancing and pullback trading. Entry thresholds and AND/OR combination are editable. Reference data is manually entered with a date/source; incomplete or old observations cannot produce a current entry flag. Index yield is distinct from fund cash distribution yield.
- Strategy descriptions do not promise returns or a success rate. Fund examples use public product information and require an explicit plan edit before saving. The updated comparison and public-copy checks are recorded in [public-copy-validation.md](public-copy-validation.md).
- Existing JSON and Excel backups remain readable; new backups retain all fund settings and observations. Automatic snapshot schema 10 adds the selected strategy and fund plan while retaining stock data and actual account totals.

## Checks

- 179 automated tests pass, including exact integer allocation, 70:30 budget interpretation, manual-data freshness, AND/OR semantics, code/weight validation, concurrent edits, reopening, JSON/Excel restoration, malformed-import rejection before any ledger write, and automatic snapshot totals.
- Browser: 320px and 390px, isolated data. A CNY 320,000 strategy produced CNY 224,000 in dividend funds and CNY 96,000 in bonds; 60% / 40% fund weights produced CNY 134,400 / CNY 89,600.
- Browser: 60% + 41% was rejected and retained the editor. A name-only 40% fund saved. Refresh restored the selected strategy and both plans. 10% drawdown and 5% index yield from today's synthetic observations produced the expected condition flag.
- Browser: the long archived ETF name wrapped completely at both widths and its code did not appear in the summary. No page-wide horizontal overflow.

Screenshots in this directory are synthetic QA examples, not portfolio recommendations. CI and APK validation do not establish a physical-device installation; no physical Android device was connected.
