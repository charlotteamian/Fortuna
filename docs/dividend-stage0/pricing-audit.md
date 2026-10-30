# 阶段 0：定价与依据链路审计

审计基线：`3163b70ae2add7f00dbc9e01c63f0ab7fa1f2c1f`，版本 5.0.0，2026-10-30。这里只读生产逻辑；新增的复现脚本使用归档/模拟数据与内存 fake IndexedDB，不连接行情、公告或 AI，不读取用户数据库。以下源码行号均指该基线。

## 判断

**v5 的主计算路径符合当前规则，主要问题出在另外一条旧网格回退路径，以及“当日完成检查”“已保存价格”“证据足够”“行情适用”之间的状态边界。** 主路径不会用现价倒推收益率，不会让 PB、历史分位、机会成本或经营风险改变固定档位；但仅证明主公式正确，不能证明首页每一档价格都来自这条路径。

本阶段没有修改计算规则、源码、账本 schema、用户阈值或已有计划。特别分红如何进入基数、历史依据如何持久化仍需用户确认后实施。

## 端到端来源与字段

| 环节 | 当前输入、来源与日期 | 输出与持久化 | 基线位置 |
| --- | --- | --- | --- |
| 结构化分红 | 东方财富 `datacenter.eastmoney.com/securities/api/data/get`，`RPT_SHAREBONUS_DET`、代码过滤、500 行；报告期 `REPORT_DATE`、公告 `NOTICE_DATE/PLAN_NOTICE_DATE`、登记 `EQUITY_RECORD_DATE`、除息 `EX_DIVIDEND_DATE`、每 10 股派现 `PRETAX_BONUS_RMB`、`BONUS_RATIO/IT_RATIO`、实施状态 | 下载对象附带原始 `pricingRaw`，`source.fetchedAt` 是下载时间，不能作公告核验时间 | `src/services/dividendResearchService.ts:27-31,84-118,125-146` |
| 正式公告 | 巨潮 `/new/information/topSearch/query` 精确 orgId，`/new/hisAnnouncement/query` 搜“实施”；12 年、最多 4 页、每次最多 12 个未缓存文档，3 并发；下载 `https://static.cninfo.com.cn/finalpage/...PDF` 全部页的可提取文本 | 独立 Dexie `FortunaDividendLedger.documents`：URL、PDF SHA-256、checkedAt、提取后的 event 或 issue；event 有原 `verifiedAt`，成功缓存不重标日期 | `src/services/dividendLedgerEvidenceService.ts:12-16,32-64,68-119` |
| 台账对照 | 官方 event 与结构化记录逐字段核对；同批去重，日期/金额/送转冲突不替换 | `FortunaDividendLedger.ledgers` 以 code 保存最新 ledger；有 reportDate、announcementDate、recordDate、exDate、per10、sources、verification/issues；不是不可变历史台账 | `src/lib/dividendLedger.ts:52-117`；`src/services/dividendLedgerEvidenceService.ts:122-129` |
| 频率与选批 | 常规最近历史判频，半年用相邻年度/中期报告期，年度至少两个不同年度历史证明频率；按实施日选最近所需批次 | `DividendLedgerBase`：税前 dpsMicros、所选 batchId、reportPeriods、latestExDate、sourceUrls、flags、verified | `src/lib/dividendLedger.ts:138-188` |
| 股本 | 每 10 股派现÷10，每笔股息再除以该笔实施日及以后已生效送/转股因子；同日股本因子只算一次，未来事件不参与 | normalizedDpsMicros，使用 BigInt 有理数累计后四舍五入到微元；送转未知/冲突不允许生成可靠基数 | `src/lib/dividendLedger.ts:120-135` |
| 年报交叉检查 | 东方财富 `RPT_F10_FINANCE_MAINFINADATA`/`RPT_DMSK_FN_CASHFLOW`，48 期；按公告日与报告日排除未来；另有代码内归档年报证据 | 最新完成年报 EPS、派息率，比较 `EPS×派息率` 与最近批次基数；严格超过 25% 阻断。缺比较字段保留 `CROSSCHECK_MISSING`，但当前 `verified` 仍可 true | `src/services/dividendResearchService.ts:21-25,36-39,159-168`；`src/lib/dividendPricing.ts:252-295,519-535`；`src/lib/dividendLedger.ts:178-186` |
| 行情 | 研究定价取腾讯非复权月线最后一条记录；页面还另有股票报价服务。报价日期、下载时间与公告时间分开 | `priceMinor/priceDate`；主计算最多接受 10 天且不得早于最近除息/送转日参与新网格现价比较 | `src/services/dividendResearchService.ts:124,132-153,166-168`；`src/lib/dividendPricing.ts:567-574` |
| 税与价格 | 用户所选 0/10/20%，默认 10%；税前基数只扣一次税；四买 `550/575/600/650 bps`，四卖 `480/450/420/400 bps`，每档 2500 bps | 税后微元 `floor(grossMicros×(10000-taxBps)/10000)`；买分 `floor(netMicros/yieldBps)`；卖分 `ceil(netMicros/yieldBps)`；5% 为参照 | `src/lib/dividendPricing.ts:6-9,510,535,581-603`；`src/lib/dividendPricingPlan.ts:7-26` |
| 预览、确认 | 当前方法、当日研究、最新所选批次及独立台账一致；原计划全状态指纹必须相同；UI beforePreview/beforeApply 均调用验证 | 预览只读；确认同时写两侧价格并保留预算/持仓/手动暂停；写入 `db.dividendStocks` | `src/services/dividendAdvisorActionsService.ts:20-57,89-106,123-137`；`src/components/DividendAdvisorPricing.tsx:103-129` |
| 保存来源 | `generatedAt/grossDpsMicros/taxBps/parameterVersion/basisKind` 5 字段 | `gridProvenance` 跟随 DividendStocks 的 JSON/Excel 备份往返，但没有当时 batchId、公告 URL、报告期/核验日期或 PDF hash | `src/lib/dividendGridProvenance.ts:4-10`；`src/lib/dividendPricingPlan.ts:30-33`；`src/db.ts:489-494,657,697-700` |
| 首页复核 | 独立台账优先，研究缓存后备；台账日期非当天时降为未核对；不在 render 下载公告 | `basisState` 三态、参数/基数/除息变更及价格触发是另算的结果；但 table 仍读取旧 `buildGrid` 回退，见 P-01 | `src/services/dividendGridBasisService.ts:7-21`；`src/lib/dividendGridProvenance.ts:41-91`；`src/components/DividendHomePlan.tsx:14-29` |

## 确认的实现缺口

### P-01：没有已保存显式网格时，首页仍可从旧公式生成价格

严重程度：高。`src/lib/dividendWorkbench.ts:183-199` 的 `buildGrid()` 在 `priceMinor` 缺失时调用 `gridAnnualDps()`，它来自手工年度假设或未来持有一年预测（`src/lib/dividendForecast.ts:131-133`），再套用旧默认 **7 档**、`Math.round` 和税前基数。与 v5 已核验最近批次、税后、四档/向下取整不同。

模拟对象：无 buyLevels/sellLevels、无 provenance、无已核验台账；手工年度股息 0.609 元；当天报价 8 元；总预算 10,000 元。`reviewDividendGrid` 正确返回 `unavailable/hasSavedGrid=false`，但 `buildDividendHomePlan` 返回：

- 买档 12.18 / 11.07 / 10.15 / 9.37 / 8.70 / 8.12 / 7.61 元；`buyState=triggered`，触发第 6 档，追加 800 股。
- 去掉手工股息，使用归档东方财富记录生成的持有一年预测，得到同样 7 档；因此问题并不只发生在手工输入。
- 标题虽然显示无法可靠判断，`DividendHomePlan.tsx:27` 无条件渲染 `DividendGridTable`；`DividendGridTable.tsx:18-26` 的行仍标“触发”，用户在同屏看到冲突结果。

修复建议：统一只读摘要必须记录每个价格的 origin。新计算只接受 v5 核验路径；合法显式历史价格继续展示并标旧/待核对；没有显式价格时显示缺项，不能用预测补成新执行价。**不要直接删改用户历史收益率计划或覆写价格**。阶段 1 先使摘要隔离旧回退价与可执行状态；阶段 2 再让页面采用摘要。若要停用/迁移已保存的收益率型旧计划，需先列明受影响范围，单独确认。

### P-02：官方当日刷新失败，旧缓存仍可被升为“当日核验价格”

严重程度：高。可重复链路：10/29 成功核验两份归档公告 → 10/30 东方财富结构化输入可用、巨潮公司查询抛 503 → 官方服务返回 cached events+issue（`dividendLedgerEvidenceService.ts:117-118`）→ `researchDividendLedger()` 创建并保存 `asOf=10/30` 的新 ledger（:122-126）→ `dividendLedgerBase()` 不读取 ledger.issues（`dividendLedger.ts:159-186`）→ 新价格 `canApply=true` → 首页 `basisState=verified`。

脚本实测：文档 `verifiedAt` 均仍为 10/29，`ledger.issues=[CNINFO_HTTP_503_SYNTHETIC]`，却 `baseVerified=true/newDraftCanApply=true/homepageBasisState=verified`。文档日期本身未被篡改，**错误是聚合状态把今天的尝试时间当成今天的成功覆盖**。

修复建议：保留旧公告、旧来源日期与已保存价格；把“本轮抓取时间、官方列表成功覆盖、文档首次核验日期”分别建模。当前关键来源刷新失败/覆盖未确认时只能“证据待核对”，不能通过新的 `asOf` 升格。历史文档无需每天重复下载；当天成功检查列表+缓存文档可构成覆盖，列表失败则不能。这是状态可靠性修复，不修改股息、税率、收益率或 25% 阈值。是否进一步以此阻断所有新价格确认，需要在阶段 1 的行动状态门禁方案里显式列出，不暗改保存接口。

### P-03：首页行情可跨越最新除息/送转边界

严重程度：高。主定价 `dividendPricing.ts:572-574` 有 `priceDate>=latestExDate` 比较保护；`reviewDividendGrid`（`dividendGridProvenance.ts:72-78`）只有最多 10 天的检查，没有同样的事件边界。

模拟：新网格 10/30 生成；当前基数 latestExDate=10/29；报价为 10/28 的 8 元。返回 `basisState=verified/quoteUsable=true/buyState=triggered`。这让新股本/现金基数与旧报价比较。修复应让统一 trigger 输出 `unknown` 并保留历史报价日期；不需改变固定档位，也不需把原“10 天参考报价窗口”改成别的天数。“可参考最后交易日”与“今日可执行”分开输出即可。

### P-04：价格算术可复算，生成时公告依据不能完整追溯

严重程度：中。5 字段 provenance 足够复算 8 档金额，但没有生成时所用两批公告的 ID、URL、报告期、原核验日、hash。主备份不包含独立 `FortunaDividendLedger` 和研究缓存数据库；原研究被替换或只恢复主账本后，无法证明当时选了哪两批。

修复建议：阶段 1 不改变主账本 schema，不伪造老来源；当前摘要明确 `historicalEvidenceAvailable` 与缺失字段。后续提交一个可选、向后兼容的“生成证据快照”字段/独立归档方案，包含所选批次、原来源及 hash、税/参数版本，并经用户确认后实施与备份回归。已有价格一直保留。

### P-05：税率变化的底层检查存在，但首页/AI 调用没有传当前税率

`reviewDividendGrid` 仅在显式 `options.taxBps` 存在时识别 tax_changed（`dividendGridProvenance.ts:65`）。首页 `DividendHomePlan.tsx:15` 及 AI 上下文 `dividendAdvisor.ts:39` 未传当前 taxBps，可能继续显示旧税档为 verified。相关 UI 调用复现见同阶段 UI/数据审计。应由统一摘要一次带入当前方法、税率与参数版本，不能各处自行取默认值。

## 需要先确认的规则歧义

### R-01：特别分红是否进入固定股息率基数，以及如何选批

当前规则文件提到“特别分红类型”但没有明确特别分红与常规年/半年批次的组合顺序。代码判频排除 special（`dividendLedger.ts:139`），实际选最近 N 批却包含 special（:162-164）。

模拟年度 payer：2024 年度 0.4 元、2025 年度 0.5 元，后有特别分红 2 元。当前输出 `frequency=annual/requiredBatches=1/base=2元`，特别分红替代正常年度基数；缺年报比较时仍 `verified=true+CROSSCHECK_MISSING`。在 10% 税下首买档会是 32.72 元；普通年度 0.5 元的同档是 8.18 元。两者都是同一固定收益率公式的算术，差别完全来自纳入什么股息。

同时，真实公告解析器只识别“半年度/中期/年度”标题（`dividendLedger.ts:216-218,242`），不能把“特别权益分派”标题解析为 special；注入 special 类型可复算，不等于正式抓取已支持。

建议先确认：特别分红作为单独前瞻/已实施事实展示，还是纳入固定基数；若纳入，是替换 N 批、附加常规 N 批、还是有用户逐笔选择。每个方案都会改变生成价，**本次不选择、不修改**。

### R-02：“交叉核验待补”与“基数 verified”不是同一件事

缺 EPS/派息率时 `CROSSCHECK_MISSING` 不阻断 dividendLedgerBase.verified，符合现文档“缺少时注明待补”的描述，但任务书要求不能把未知写成安全通过。因此统一摘要应把“公告现金基数已核验”与“财报交叉核验未知”同时输出；不要直接把缺财报变成不存在/已经安全。是否要求缺交叉核验也禁止确认所有新网格，是门槛变更，需要另行确认。

### R-03：风险、价格事件和新增操作资格

v5 规则将经营/专项/技术信号视为复核信息，不自动暂停、不改价格；任务书要求选股未过+触价时显示“到价，暂不新增/应先复核”。统一摘要可以保留原股息率价与手动 buyPaused，给出独立 actionCheck，无需写入暂停。若阶段 1 需要新增硬性禁买规则（而非用户确认前的提示），必须先明确哪些规则、阈值和影响，由用户确认。

## 固定历史/模拟样本复算

平安银行样本来自仓库归档正式公告正文，并非今天重新抓取/当前报价：2025 年度每 10 股 3.60 元，2026 中期每 10 股 2.49 元；税前 `360000+249000=609000` 微元/股。

| 税率 | 税后元/股 | 四买（元，向下取分） | 四卖（元，向上取分） |
| --- | --- | --- | --- |
| 0% | 0.609000 | 11.07 / 10.59 / 10.15 / 9.36 | 12.69 / 13.54 / 14.50 / 15.23 |
| 10% | 0.548100 | 9.96 / 9.53 / 9.13 / 8.43 | 11.42 / 12.18 / 13.05 / 13.71 |
| 20% | 0.487200 | 8.85 / 8.47 / 8.12 / 7.49 | 10.15 / 10.83 / 11.60 / 12.18 |

例如默认首买：`floor(548100/550)=996分`；首卖：`ceil(548100/480)=1142分`；每档 25%。税未重复扣。

| 样本 | 当前结果 | 异常分类/处理 |
| --- | --- | --- |
| 000001 历史半年两批 | 税前 0.609，默认四买四卖见上 | 正常；不套用最新单期中期×2，也不滚动 TTM |
| 模拟年度两年历史 | 最近一批 0.5 元 | 正常；历史只用于判频，不把两年相加 |
| 模拟半年相邻批次/同批重复 | 去重后仍 0.609 元 | 正常；ID 去重有效 |
| 模拟最新批现金冲突 | 无新价，SOURCE_CONFLICT | 来源冲突；先重试与定位两源，不退回旧批补价；有旧计划时保留旧计划 |
| 模拟最新公告缺失 | 无新价，ANNOUNCEMENT_UNVERIFIED | 资料缺少/解析失败；具体区分请求与解析原因，不伪造公告 |
| 模拟 2 页仅取 1 页 | 无新价，SOURCE_PAGES_INCOMPLETE | 抓取不完整；分页补齐，不降低门槛 |
| 模拟年度只有 1 个历史批次 | 无新价，FREQUENCY_UNKNOWN | 频率证据不足；补历史，不能臆测年度 |
| 模拟同日 10 送 8，后来 10 转 5 | `1/(1.8×1.5)+0.2/1.5=0.503703` 元（按事件归一后求和） | 正常；同日也调整，0现金股本事件不当作现金批次 |
| 模拟年报比较恰好 25% | 允许；偏离多 1 微元时阻断 | 正常；精确整数比较，不用显示四舍五入值决策 |
| 模拟特别分红替代年分红 | 2 元替代 0.5 元，首买默认 32.72 元 | 规则歧义 R-01；先确认，不改算法 |
| 模拟无显式计划/旧年度预测 | 标题 unavailable，表格仍给 7 档且“触发” | 实现缺口 P-01；来源与状态隔离 |
| 模拟官方 503+旧缓存 | 当日 verified+可生成新价 | 实现缺口 P-02；成功覆盖与尝试日期分离 |
| 模拟新除息日+旧报价 | 首页 verified+触发 | 实现缺口 P-03；报价与股本事件边界统一 |

## 复现与阶段 1 建议

运行 `node docs/dividend-stage0/reproduce-pricing.ts`：17 个记录样本的当前行为断言通过，并产生 `pricing-samples.json`。`npx eslint docs/dividend-stage0/reproduce-pricing.ts` 通过。复现脚本把“确认存在的错误”也作断言固定下来，是审计证据，不是接受该行为的生产回归测试。

阶段 1 应仅新增只读统一摘要与消费测试：独立输出 eligibility、grid、trigger、risk、actionCheck、freshness；显式记录价格来源、分红核验覆盖、行情适用边界、当前税率。保留所有原价，不调用保存 API、不改默认阈值、不自动暂停。先覆盖 P-01/02/03/05 的防误报测试及“原价不变”断言，后续才让首页/详情/今日检查逐步复用。P-04 证据快照持久化与 R-01/02/03 的门槛/计算口径变动另列方案等待确认。
