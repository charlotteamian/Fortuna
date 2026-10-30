# 阶段 0：风险、到价与今日检查审计

审计基线：`3163b70ae2add7f00dbc9e01c63f0ab7fa1f2c1f`，5.0.0 / calculationVersion 5；观察日 2026-10-30。只读源代码核查与隔离模拟复现，没有改生产代码、交易、持仓、预算、手动暂停或真实数据库，没有请求外部 AI。下列行号均指此基线。

## 结论

数值筛选已经区分 `pass / risk / unknown`，风险主题也已去重；目前不存在以风险项数量计算的总评分。主要缺口是**价格到档、选股是否符合、是否可以新增操作分别由不同代码计算，尚无统一执行结论**。今日建议依赖模型；无模型时不能完成任务书要求的确定性今日检查。模型数值草案经过严格限制，但可见自然语言建议没有同等的规则校验。

本阶段不改变股息率、税率、频率、25%交叉校验、默认选股阈值或暂停设置。风险和技术信息不应改写价格；新摘要中的“先复核/暂不新增”也不能偷偷持久化为 `buyPaused`。

## 当前链路与已有保障

| 环节 | 现有实现及证据 | 已确认的边界 |
| --- | --- | --- |
| 财报抓取 | `src/services/dividendResearchService.ts:121-175`，东方财富财务/现金流，腾讯日/月线；`src/lib/dividendResearch.ts:183-210` | 校验代码、报告日、公告日，不读未来财报；财务抓取失败保留明确 issue，不捏造通过。 |
| 可编辑筛选 | `src/lib/dividendResearch.ts:127-140,242-281` | 新默认股息率4%、年报ROE8%、营收/利润同比0%、非金融负债率70%、经营现金/利润80%、FCF覆盖150%、最高派息100%、连续5年。已保存原则由上层加载，不重置。金融企业改用专项检查。 |
| 年报/季报 | `src/lib/dividendResearch.ts:195-205,256-258` | 季度累计ROE只供有标签的年化展示；筛选ROE仍用年报。最新财报超过230天、年报超过15个月会改为unknown。此处只是盘点现有阈值。 |
| 风险聚合 | `src/lib/dividendResearchAdvice.ts:28-52,73-82`；`src/lib/dividendReviewSummary.ts:34-82` | 已知不达标与缺证分开；同一主题去重。没有严重度、来源日期、影响、能否自动修复、未修复如何处理等结构化字段。 |
| 首页操作量 | `src/lib/dividendWorkbench.ts:204-226` | 累计目标减去现有股数、按整手处理；买入手动暂停、缺预算、预算空、已覆盖、零持仓卖出等状态已有确定性实现。报价失败不抹去旧价。 |
| AI上下文 | `src/services/dividendAdvisorContextService.ts:14-41`；`src/lib/dividendAdvisor.ts:21-86` | 每次显式提问刷新；仅红利计划及相关持仓进入上下文，不带账户名称/其他资产；基金与股票预算分开。 |
| 数值/暂停动作 | `src/services/dividendAdvisorService.ts:150-180,239-244` | 模型价格必须匹配确定性四买四卖；不允许凭风险自动暂停；恢复须独立复核；这里只产生草案，实际变更仍需预览确认。 |
| 今日建议保存 | `src/components/DividendDailyAdvice.tsx:31-49,60-64`；`src/services/dividendDailyAdviceService.ts:15-29` | 失败、取消、迟到的模型响应不替换上一次完成建议；只保存可见文本和作用域，不保存凭证或机器动作。跨日及持仓/计划变化有旧结果提示。 |
| 来源时间 | `src/services/dividendResearchService.ts:104,144-148,215`；`src/lib/dividendResearch.ts:338-346` | 新抓取的 `fetchedAt` 和研究 `generatedAt` 是请求/研究时间；财报 `asOf` 仍是报告期，不改成今天。研究缓存合并保留每只股票的上下文时间：`src/services/dividendResearchCacheService.ts:39-62,71-85`。不能把“今天重新下载旧财报”解释为原文今天完成新核验。 |

## 具体问题与复现

复现命令：`node docs/dividend-stage0/reproduce-risk.ts`。结果见 `risk-samples.json`。所有价格、证券名称与模型回答均为模拟；AI运输通过本地函数 stub 替代，网络请求为零；fake-indexeddb仅作为运行环境，不写数据库。

### R1｜高：没有与到价并列的确定性执行资格

`src/lib/dividendResearchAdvice.ts:36-82` 把 `failedRules`、`missingRules` 提取后，最终 `decision` 只由报价和档位决定（第80行），不读取手动暂停、预算和持仓。`eligible` 的实际含义是“价格到档”。`src/components/DividendAdvisorWorkspace.tsx:56-57` 目前将它映射为价格触发，不能指控此处直接自动交易；但这个名称若直接复用为“可以执行”会造成错误。

R01：模拟买档10元、报价9元、年报ROE5%小于用户门槛8%、银行专项缺证且手动暂停，研究仍返回 `decision=eligible`、到第1档；首页却返回 `buyState=paused`。当前缺少统一的“到价；已手动暂停，不能建议新增买入；ROE未达标且专项待核实”结论。应保留价格事实并补只读 actionCheck，不修改档位，不更改暂停。

旧文档 `docs/dividend-pricing-method.md:57` 和现有风险说明均要求经营、专项、技术只作提示。新任务书要求“原则不通过但价格触发”同时显示“到价+暂不新增/应先复核”。**可以先做展示/本次检查阻断，不可据此自动暂停计划、强制所有一般风险通过或改公式**。若要把某一风险永久设为交易硬门槛，应单独获得用户确认。

### R2｜高：AI输入中的价格触发与首页报价有效性不一致

AI上下文在 `src/lib/dividendAdvisor.ts:53-54` 直接使用 `buildGrid()`。后者 `src/lib/dividendWorkbench.ts:197-199` 仅比较原始报价与价格档位，不检查日期或本轮刷新失败；可见快照在 `src/lib/dividendAdvisor.ts:170-182` 仍输出 `Saved quote reaches this price=true`。首页用 `buildDividendHomePlan()` 的第208-212行先检查有效性，因此出现冲突。

R03：报价9元、买档10元，但行情日期2026-10-01（29天前），首页 `quoteUsable=false / quote_missing`，AI输入仍 `reaches=true`。R04：当日9元报价、本轮刷新失败，同样首页不可用而AI输入仍true。上下文同时附有源日期/刷新失败，prompt也提醒不能宣称当前触发；但这是依靠模型自行化解相互冲突的输入，不是确定性保证。

修法：AI解释、首页和详情都消费同一份只读 trigger，保留原价及源日期并标“历史报价”，不得把未知写成未触发或当日触发。这不改变分红价格公式，也不删除旧行情。

### R3｜高：当前允许10天内旧股价触发，新任务要求“今日/可执行”更严格

`src/lib/dividendWorkbench.ts:206-209` 接受0–10天行情；`src/lib/dividendResearchAdvice.ts:65-80`复用此条件；基金入场相对严格，`src/lib/dividendFundPlan.ts:103-120`要求相关输入日期为当日。R02：观察日10月30日、股票报价10月29日15时，首页仍 `triggered`。

这与现有方法文档第47行一致，但不满足新任务书“非当日或无法确认适用交易时段，不写今日已触发可执行”。建议**保留旧价的价格比较，新增 current/latest_available/historical 的行情适用性及明确的 asOf 标签**；前一交易日结果只描述最后报价的到价事实，当日 actionCheck=unknown/review。尚无交易日历、停牌或来源会话证据；不能仅因日期是工作日或刷新发生在今天就判定实时可成交。若要改变底层“10天是否可作比较”这一阈值，需要用户确认；阶段1可以先不改它，仅阻止升级为当日可执行结论。

### R4｜高：今日检查依赖AI，且可见模型文本没有规则护栏

`src/components/DividendDailyAdvice.tsx:26-28` 未配置AI就打开设置，`33-43`必须等模型完成才产生结果。虽然 `dividendResearchAdvice()` 有确定性判断，其结果未成为“今日清单”。AI请求失败时只能继续显示旧建议，无本轮确定性检查结果。

`src/services/dividendAdvisorService.ts:150-180`核验机器动作，不核验通常的可见文字；`src/components/DividendDailyAdvice.tsx:38-44,63`直接保存/显示 answer。R05：同R01的暂停+不达标输入，让本地stub返回“今天已到价，请立即新增买入100股”，服务原样返回，`actions=[]`。这证明缺少输出护栏，**不代表真实模型本次实际说过该话或发生真实交易**。

修法：先确定性构造排序清单与操作约束；模型只能解释这份清单。主结论、价格、执行条件由代码渲染，文字解释不得覆盖它们。未配置、超时或失败都保留本轮清单，模型文本在其下单独展示。不要用另一个模型判断第一个模型是否合规。

### R5｜中：可取消反馈仅覆盖模型等待，前置刷新继续执行

`DividendDailyAdvice.tsx:29-38,51` 建立AbortController，但第33行没有把signal传入 `prepareDividendAdvisorContext()`。该服务第16-37行的研究、行情和分红刷新没有signal入口，进度回调也被页面传成空函数。`dividendResearchService.ts:195-215` 的60秒预算限制的是开始下一只股票，不是整次研究的硬结束时间；单只股票/巨潮证据工作仍可继续。

因此“取消”可阻止迟到建议覆盖当前结果（已有保护），却无法停止已启动刷新及缓存写入，也没有行情→公告/财报→计划核验→结果的阶段覆盖进度。建议阶段3显式区分取消结果、取消网络及允许完成的只读缓存写入；给全流程deadline，逐项失败可重试。不得声称目前具有全流程硬超时或完全取消。

### R6｜中：银行补充证据计算可用，但实际抓取链路未接入

`src/lib/dividendFinancialSector.ts:17-29,94-154`支持带报告期/发布/核验日期与来源的 `DividendBankReportEvidence`，对应测试覆盖关注类贷款、90天以上逾期与内生资本支持。`src/lib/dividendResearch.ts:183,210`接受该可选参数；生产抓取 `src/services/dividendResearchService.ts:129`仅传raw与code，仓库src中无其他生产调用传入bankEvidence，也未找到其保存/编辑入口。

R06：常规银行feed能给资本充足率等，但上述三项仍unknown。现有行为诚实地显示缺证，不能说风险已验证通过；任务书要求减少手工复核，目前该能力只是计算接口，未形成自动收集/核验的闭环。应先在风险项给具体缺失字段及可重试边界；以后接原文证据时单独实施，不把普通工业现金流或总逾期字段作为替代。

### R7｜中：风险文本与当前约定有两处口径漂移

`src/lib/dividendResearch.ts:296,304`给模型的 `pause_add` 解释为“Pause additional buying…”，但 `src/lib/dividendAdvisor.ts:248,256`又明确技术是提示、不得自动建议暂停。两段同时进入请求。应统一为“加速下跌，提醒复核”，不写回暂停。

同文件第326、348行仍将收益率原则称“Trailing”/过去窗口，但实际最新收益率由 `dividendResearchService.ts:151-153,172`的recent-batch ledger生成，第381行也已改为recent-batch。第345行还对AI输出旧 requiredReturn/growth/safetyMargin 等参数标签。应在显示层准确说明当前核验基数，旧算法参数只保留为历史字段。这是文案/快照映射修复，不应重新启用三锚、TTM或额外折价。

### R8｜中：已完成建议的失效指纹未覆盖证据内容变化

`src/services/dividendDailyAdviceScopeService.ts:5-16`包含计划、原则、税期、持仓和手工参考，明确排除市场刷新时间；这避免每次下载就无意义作废，方向正确。但同一日新公告台账、财务/风险结论或行情适用性发生实质变化时，它们未进入planKey；`DividendDailyAdvice.tsx:52-53,62`只按跨日、planKey和语言提示旧结果。可能继续展示同日旧建议而无针对新证据的失效提示。

阶段1摘要应提供 semanticFingerprint：仅含影响结论的价格源时点/值、台账批次指纹、风险输入及计划版本，排除fetchedAt等纯下载时间。已完成检查与本轮刷新失败并存，不能悄悄把旧结果标为今日完整检查。

## 阶段1建议的统一只读模型

建议新增 `src/lib/dividendCheckSummary.ts` 及对应测试，由纯函数把已有服务结果整理为以下结构。**这是设计稿，尚未新增类型、数据库或执行门槛**。股票/基金用kind区分，复用摘要框架，计算各自调用原有规则。

| 区块 | 建议字段 | 确定性边界 |
| --- | --- | --- |
| identity | kind、code/id、name、held/watch、checkId | 依据保存列表和实际记录；不据缓存历史恢复已删除的列表成员。 |
| eligibility | pass/fail/unknown、最多3条coreReasons、ruleResults | 股票现有risk→fail，unknown→unknown；有明确fail且也缺证时仍fail并附unknown项；不能用风险数量当分数。基金展示既有条件是否满足，不能套股票财报门槛。补充自由文本原则始终标未自动核验。 |
| grid | verified/saved_unverified/unavailable、origin、buy/sell levels、next buy/sell、taxBps、gross/netDps、version、generatedAt、batchIds、sourceUrls | 新核验价格与已保存执行计划分开，禁止自动替换。无新价有旧价则展示旧价与原因；基金使用原模式目标与参考信息，不填股票dividendBase。 |
| trigger | triggered/not_triggered/unknown、buy/sell、reachedTiers、comparedGridOrigin、quoteUsability、sourcePrice/date、comparisonAsOf | 只描述适用行情下的价格事件；last_available与today_execution明确分开。不将unknown当未触发。前日、失败、来源不一致、未来、不合法报价不能升级为“今日可执行”。 |
| risk | blocking/attention/evidence_insufficient、稳定ruleId、reason、sources、reportPeriod、publishedAt、verifiedAt、impact、autoRepair、unresolvedAction | blocking需可追溯明确依据；未知只进缺证类；一般技术/经营提示不改价格/暂停。冲突与缺证的修复策略分开。 |
| actionCheck | blocked/review/wait/confirmation_candidate/unknown、blockerIds、requiresUserConfirmation、budget/position/lot constraints | 手动暂停必blocked；价格未到则wait；到价但筛选fail/必要证据未知则review，保留触价事实。即使全满足，也只允许人工确认候选；缺账户现金/费用/流动性不能说已具备全部成交条件。不能自动下单、写网格或交易。 |
| freshness | generatedAt、attemptedAt、quoteSourceAt、quoteFetchedAt、financialReportPeriod/noticeDate、evidenceVerifiedAt、researchGeneratedAt、coverage、failure/deferred、semanticFingerprint | 下载、报告期、发布、原文核验和研究生成分别保留。失败只记录attemptedAt/issue，保留旧来源时间；不以today改写历史verification。 |

最小优先级：手动暂停/可靠性严重阻断 → 到价但不能执行 → 条件满足可考虑人工确认 → 未到继续观察 → 数据缺失。列表本身还可将未知资料单列覆盖率，不能因排序靠后就隐去关键缺证。

### 阶段1验收测试矩阵

| 输入 | 必须同时输出 |
| --- | --- |
| 原则pass，新价核验，未到价 | eligibility=pass；grid=verified；trigger=not_triggered；actionCheck=wait。 |
| 原则fail但到价 | eligibility=fail；trigger=triggered；actionCheck=review并指明失败规则；不改档位。 |
| 新证据缺失，有保存网格 | grid=saved_unverified；保存价格/生成日期可见；不能覆盖旧网格。 |
| 新证据缺失，无保存网格 | grid=unavailable，缺失原因具体；不生成估价。 |
| 报价为上日、过期、未来、刷新失败或来源会话不明 | 可保留最后比较结果，但当前trigger=unknown或明确last_available；当日actionCheck不能确认可执行。 |
| 手动暂停且到价 | 触价仍可见；actionCheck=blocked(manual_pause)；不得建议新增或替用户恢复。 |
| 缺证与已知风险同时存在 | 分别保留；不把缺证当风险、通过或总评分。 |
| 基金手工高点/指数息率/价格任一过期 | 各自标日期与受影响条件；保留both/either短路逻辑，不套股票公式。 |
| 无AI或AI失败 | 本轮确定性结果完整保留；AI解释可缺失；不会自动写计划。 |
| 今天重新下载旧财报、失败后保留旧台账 | 源报告期/核验日期不改变；attemptedAt单独更新。 |

实施顺序：先纯函数与模拟回归→各组件增量读同一模型→确定性今日清单→可选AI解释。第一阶段不重构账户/持仓schema，不迁移网格，不改计算阈值；行为存在规则争议的项目先明确记录为review/unknown，等待用户确认后另立改动。
