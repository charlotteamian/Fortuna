# Changelog

All notable user-facing changes are documented here.

## [Unreleased]

## [2.0.0] - 2026-10-21

- 按用户红利定价方法拆开可持续分红 D₁、收益率三锚、Gordon／PB–ROE 校验、安全边际及三档网格；参数与归一收益依据可在助手中保存。
- 自动补取国债、历史分红与未复权价格、财务和现金流资料，按来源与日期呈现计算链和具体缺口。
- 红利页改为最新报告单期分红，并单独预测从今天起持有一年的分红；公告替换同一期历史预测，已除权事件不重复领取，未披露金额不回退旧 TTM。
- 主页面精简为行情、单期分红和一年预测；预算、股票和基金策略、网格等管理收进红利助手的计划管理页签。
- 保留历史聊天、个股与指数节奏分析、风险检查及有持仓保护；网格预览确认后反写，模型不能凭空写入未通过方法校验的价格。
- 正式版本规则：功能大更新递增主版本，修复递增末位；Android、iOS 内部构建号继续递增。

## [1.6.1] - 2026-10-08

- Use public-facing strategy explanations in Chinese and English, retaining editable entry references and the existing holding approaches.
- Add a comparison of ten dividend funds by code, index, product type, venue, management/custody fees and public product source, plus a separate bond allocation example.
- Open an editable allocation when adding a comparison fund to a plan; reopen the existing plan for an already saved code.
- Adapt the comparison to narrow phone screens and keep product information separate from saved plans.
- Android version code 13, using the same pinned release certificate for in-place updates.

## [1.3.2] - 2026-09-22

### Simpler allocation plans

- Show each asset class's planned and current amounts and percentages together, followed by progress and the remaining or excess amount.
- Record intended purchases by name or code without first creating holdings or allocating subcategory percentages.
- Make edit buttons visible; keep allocation charts, account/holding splits and existing subcategories available on demand.
- Support amount or percentage entry with an explicit calculation basis; preserve precise amounts and existing product links.
- Preserve purchase notes in Excel backup/restore and automatic snapshots.
- Create initial plans atomically from existing assets without rounding the total allocation above or below 100%.

### Android release

- Version code 7, using the same pinned release certificate as 1.3.0 and 1.3.1 for in-place updates through Settings → About.
- Run data and update regression tests before every signed GitHub APK build.

## [1.3.1] - 2026-08-02

### Account controls and layout

- Moved hiding and total-inclusion controls into the account long-press menu, removing the repeated hide buttons from the overview.
- Replaced the account-form inclusion control with a compact switch layout.
- Replaced the long inline hidden-account list in Settings with a single button and recovery sheet.

### Fixes and polish

- Fixed un-hiding an account resetting the current amount-visibility state.
- Replaced the narrow monospace amount style with the app's regular asset-number typeface across balances, values, prices, and P&L.
- Moved the Android update button directly into About and removed the explanatory update panel.

## [1.3.0] - 2026-08-02

### Stable Android updates

- Established a permanent Android release-signing identity and changed GitHub releases from ephemeral debug signing to verified release signing.
- Added an Android-only update section under Settings that checks the official GitHub release, shows release notes, downloads the signed APK, and opens Android's installation confirmation.
- Added native validation for the trusted GitHub URL, Fortuna package name, higher version code, and exact match with the currently installed signing certificate before installation can start.
- Added CI certificate pinning so a release fails instead of publishing an APK signed with an unexpected key.
- This version is the one-time signing transition: users of 1.2.1 or earlier debug builds must export a complete backup, uninstall the old app, install 1.3.0, and restore. Releases after 1.3.0 can update in place.

## [1.2.1] - 2026-08-02

### Account visibility and valuation control

- Added an independent per-account switch for including assets or liabilities in total assets, total liabilities, net worth, and allocation-plan calculations.
- Added presentation-only hiding for accounts, with a direct overview action and a Settings recovery list. Hidden accounts remain included in totals unless the inclusion switch is separately disabled.
- Kept overview subtotals, product summaries, charts, reports, Excel backups, and portable snapshot schema v7 aligned with the two independent states.
- Preserved backward compatibility: existing accounts remain included and visible until the user changes either setting.

### iOS and App Store readiness

- Aligned the iOS marketing version with the current package release and added a release guard that verifies every bundled web asset after Capacitor sync.
- Added an app privacy manifest, localized calendar permission copy, iOS-specific snapshot guidance, and current App Store submission materials.
- Added Xcode 26 CI compilation and a signed-archive workflow so future iOS builds cannot silently ship stale frontend content.

### Product story and bilingual demo

- Reframed the product around four differentiators: full-asset consolidation, supported market-price refresh, plan-versus-position tracking, and local-first data portability.
- Split the GitHub introduction into independent Chinese and English sections, each paired with matching-language screenshots.
- Added a complete English synthetic JSON/Excel demo alongside the Chinese demo.
- Added the same product-differentiation explanation to the in-app user guide.

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
