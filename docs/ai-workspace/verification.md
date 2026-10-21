# Dividend AI workspace and screenshot subscription filtering — 1.10.0

## Behaviour

Screenshot recognition excludes new-bond subscription placeholders in both extraction instructions and local validation. Normal listed bonds, convertible bonds and secondary-market executions remain eligible. An all-subscription result preserves the previous preview and writes nothing.

The assistant stores full local conversations in an independent Dexie database, with explicit new/resume/delete controls and retry on save failure. Conversation persistence whitelists text and validated plan drafts; transport credentials, account identities and full snapshots are excluded. Conversation history is separate from asset backups. Selection rules are saved in the ledger settings and round-trip through JSON and Excel replacement backups.

The reading workspace has Chat, Screen & review and Selection rules tabs. Research cards, financial periods, technical metrics, sources, history and grid details use disclosures. The assistant uses recent stock and index daily prices, implemented dividends and dated structured financial fields. A deterministic pacing check creates pause drafts for fresh accelerating declines. Drafts never write directly; preview and separate confirmation are required. Grid writes are field-scoped and reject malformed, crossed or stale drafts.

Stock eligibility uses editable quantitative thresholds with separate unknown states. Financial-sector debt and operating-cash ratios are not compared mechanically with ordinary companies. Stale reports cannot create current financial breaches. Risk removal is explicit, retains unused allocations and rechecks manual and all linked positions inside the deletion transaction, including archived/hidden accounts and future positive holdings. Technical timing is separate from financial eligibility.

## Verification

- 288 Node tests; screenshot filtering, history lifecycle/reopen, save whitelists, current discussion evidence, financial/technical parsers, stale/missing evidence, plan confirmation, held-stock removal and backup round trips.
- ESLint, TypeScript and production build; final web assets synchronised to Android and iOS, iOS readiness check.
- Android unit-test Gradle task passed (15 updater cases plus the existing example test; up-to-date results reused because native implementation was unchanged).
- Isolated Playwright flow with synthetic records and simulated model/market responses: saved rules and notes, chat and restart/resume, pause preview/writeback, held-stock risk-removal protection, candidate add at zero weight, privacy masking and no horizontal overflow at 390×844 and 320×740. Screenshots and browser-validation.json are adjacent.
- Real Tencent and Eastmoney endpoint responses were inspected and reduced to public-source fixtures for bank/company financial fields, implemented distributions and index daily data.

## Coverage limits

Structured financial data is not a full filing, auditor-opinion, governance or news review. Supplemental qualitative rules require explicit AI/user review and are not automatically counted as satisfied. The candidate pool is bounded and is not an all-market scan. Browser transport simulation does not validate real configured model quality. No physical Android device was attached for cover-install or data-retention verification.

Signed release, digest, resources and update detection are checked after publication; the release verification record is kept separately.
