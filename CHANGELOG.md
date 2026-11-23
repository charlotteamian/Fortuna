# Changelog

All notable user-facing changes are documented here.

## [Unreleased]

## [3.7.0] - 2026-11-23

- **组合净值改为时间加权单位净值**：投资组合净值曲线按时间加权单位净值计算，消除出入金对历史净值与累计收益的稀释与扭曲，与账户页真实盈亏方向一致。
- **交易手续费模型升级**：每笔交易的手续费随成交持久化（含全局最低佣金与印花税），支持按票自定义费率并在编辑时保留既有费用不被重算；卖出数量超过当日可卖数量时直接拒绝并提示，不再静默截断导致持仓与已实现盈亏错乱。
- **逻辑与数据正确性修复**：归档账户、持仓、计划改为事务化删除并清理关联价格监控；沪市可转债（`110/113`）改按数字前缀路由到沪市行情；场外基金优先采用已公布净值而非盘中估值；红利基金网格优先使用已存参考锚点净值；计划在无行情时显示「行情缺失 · 档位待定」而非虚假的满仓加仓建议。
- **红利与计划展示修复**：过期红利台账不再让首页网格仍标「已核验」；图片报告的贵金属账户按货币价值展示克数对应的金额（不再把克数当金额），表头合计与明细口径一致；切换主币种时计划目标总额按汇率换算；走势图区间选择器在所选区间无数据时保持可切换；经典策略与计划日期改用本地日期。
- **隐私与安全加固**：关闭安卓系统自动备份（账本与本地 AI 密钥不再进入 Google 备份），FileProvider 仅暴露应用私有缓存目录，红利 AI 概念问答不再上传完整持仓快照，发布工作流不将 tag 输入直接拼入 shell 并校验版本号；`xlsx` 升级至 SheetJS 修复版 `0.20.3`。

## [3.6.0] - 2026-11-20

- **新增交易手续费自动计算与按票自定义费率**：在「设置 → 交易手续费」新增全局默认佣金费率（默认 `0.01%`，即万分之 1），股票/ETF 买入与卖出自动按成交额计算手续费并计入持仓成本、已实现盈亏、摊薄成本、月度盈亏与组合净值；支持在单只持仓编辑页按票覆写费率（含 `0%` 免佣）以及在单笔交易中手动覆写手续费；费率与手续费完整随 JSON/Excel 备份与自动快照往返。
- **新增当日做 T 匹配（LIFO）与 `T` 标识展示**：持仓核算升级为当日做 T 配对（同时支持先买后卖「正T」与先卖后买「倒T」）加跨日后进先出（LIFO）成本结转；参与当日做 T 配对的交易记录在明细中显示醒目的 `T` 徽章以及配对均价与扣费后做 T 净盈亏，持仓展开卡片新增「当日做T盈亏」与可一键跳转改费率的「手续费」汇总项。

## [3.5.4] - 2026-11-19

- **支持截图 AI 识别提取成交时间与同日做 T 录入**：AI 识别新增提取券商截图中的「成交时间」（`HH:MM:SS`）并自动按时间顺序重排同日多笔买卖（即使截图倒序展示也能正确排序）；导入确认弹窗支持查看与编辑每笔成交时间；写入账本时结合成交时间与同日校准/既有记录的时间顺序自动归位，不再误报“已有同日成交或校准记录无法确定先后”而阻止同日做 T 录入；同时保留成交时间于交易明细、便携快照及 JSON/Excel 备份。
- **修复投资组合单位净值与累计收益计算偏差**：组合单位净值图表不再把区间首日已产生的浮亏强行归零为 `1.0000` 再做除法换算（此前若首日买入标的亏损而后续加仓稀释亏损率，会导致仍处亏损的组合误显示正收益）；历史交易节点改按当时已知成交价/成本价估值，最新节点按当前行情价估值，使图表中的最新单位净值、累计收益与账户页真实盈亏方向一致，同时消除因后期校准引发的历史净值异常尖峰。

## [3.5.3] - 2026-11-19

- **修复仓位阶梯网格触发判定逻辑**：去除价格/指数/股息率阶梯网格的中点提前触发算法，改为严格按档位阈值触发——价格或指数需真正跌入档位区间（`现价 ≤ 触发价`）、股息率需真正升至档位门槛（`股息率 ≥ 触发值`）才命中该档位；同时加宽价格模式阶梯表首列（`30%`），避免 `● <3500` 等参考点位被截断。
- **优化红利股摘要卡片排版**：将红利股卡片摘要改为双列对齐网格展示现价、税后股息、权重、预算与持仓，去除杂乱的点号分隔符与折行前导点；调整标题与右侧徽章间距和换行策略，防止「长江电力 (600900)」等名称中间折断；移除「今日触发」末尾的「待更新」计数并避免数字折行。

## [3.5.2] - 2026-11-18

- **表格内直接编辑网格**：计划页阶梯网格、红利股 4 列网格及选股工作台经典网格均支持在原表格格局下直接内联修改点位/股息率/仓位并保存，不再需要逐条拆行重填。
- **红利股展示修复**：优化窄屏卡片摘要双行排布，防止股息率徽章、金额与股票代码截断或折行；红利股表格恢复「股息率 | 触发价 | 仓位/减 | 金额」4 列并增加定价口径说明；卖出档位不足 1 手（100 股）时显示「不足1手」而不再误显示 `0.00`；已持有但归为隐藏分组的红利股保留展示。
- **红利基金参考价锚定与更新提醒（方案 A1）**：抓取历史单位净值并按日期对齐中证官网最新指数股息率，固定等效年分红（`官网当日指数股息率 × 当日基金净值`），各档位参考价盘中保持固定不再随现价漂移；高亮档位与实时估算股息则随盘中现价实时联动；当官网新指数股息率或对应基准净值更新时，卡片内展示变更明细提示条并支持点击「知道了」持久化关闭。

## [3.5.1] - 2026-11-18

- **红利股计划表优化**：去除“买 1 档 / 卖 1 档”文字前缀，保留 `点位价格 | 累计仓位 | 金额` 3 列避免窄屏截断；修复每档均按单档 25% 计算导致金额重复的问题，买入区按累计仓位（25%/50%/75%/100%）递增计算金额，卖出区按当前持仓股数显示累计减仓金额（无持仓时在分组标题标注「无持仓」且金额显示 `—`）。
- **红利基金自动抓取跟踪指数股息率与基金派息**：自动从天天基金/东财接口识别基金跟踪指数并读取历史分红记录，从中证指数官网抓取各指数官方股息率（`D/P1`，例如中证红利低波 `H30269`、中证红利低波 100 `930955`、中证红利 `000922`），取消跨基金统一默认值兜底，并在卡片明确区分展示「跟踪指数股息率」与「基金近12月派息 / 基金本身暂无派息」。

## [3.5.0] - 2026-11-17

> 自 `2.0.0` 以来的阶段性稳定整合版本（清理并合并了此前多次试验性与修补版本，后续恢复标准语义化版本节奏）。

- **计划页层级展示与四种管理模式**：支持「阶梯网格」「个股/基金卡片」「红利价值组合」「基础配额+备注」四种计划模式；设置子分类的卡片按「母分类实际占比 → 策略备注 → 子分类占比 → 子分类下计划与仓位阶梯」展示；内置全局活钱蓄水池自动对账。
- **红利基金网格与红利股触发内嵌计划页**：红利资产卡片包含「红利基金」「红利股」子分类区块（PlanTarget 支持 `role` 字段并随 Excel/JSON 备份往返），基金按指数股息率换算为基金买入档位价格，红利股展示今日触发摘要与可展开的四买四卖阶梯；红利工作台精简保留 AI 问答与选股计划，预算自动随对应子分类同步。
- **经典红利定价与派息封顶口径**：以已核验最近批次分红与最近年报每股收益封顶（`min(已实施分红, 年报每股收益)`）作为统一定价基数；支持 20%/10%/0% 三档红利税率、手动价格模式、对称市场偏离提示、安全清理标的及公告 PDF 交叉核验。
- **组合单位净值、现金倒减与价格监测**：投资组合支持按初始金额 + 已实现盈亏 − 持仓市值倒减闲置现金，支持按命名组合统计单位净值（消除出入金扭曲）；支持股票/ETF/黄金到价提醒与全局页签/子页面滚动位置记忆。
- **版本规范调整**：恢复标准 `MAJOR.MINOR.PATCH` 语义化版本管理；Android `versionCode` 与 iOS build number 保持单调递增至 `59`。

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
