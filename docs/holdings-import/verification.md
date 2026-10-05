# 当前股票资产的截图 / Excel 导入

入口：股票/ETF 资产详情的「截图 / Excel 导入持仓」，也可从「添加持仓」进入。首次在「设置 → 视觉 API 配置」选择服务商并填写密钥，可修改协议、地址、模型；之后选择截图即可识别。导入页提供设置入口，返回后保留预览。可以追加多张截图，分别预览持仓与买卖记录；确认后写入当前资产，并尝试刷新最新行情。

支持 OpenAI 兼容 Chat Completions、Gemini GenerateContent、Anthropic Messages。地址支持服务商基础地址或完整 endpoint。常见基础地址：

| 协议 | 基础地址 | 凭证 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` 或服务商兼容地址 | Bearer API Key |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | x-goog-api-key |
| Anthropic | `https://api.anthropic.com/v1` | x-api-key |

模型必须接受图片。配置存入独立 Dexie 库 `FortunaHoldingRecognitionConfig`，不进入资产账本备份、Excel 备份或自动快照。截图仅在用户选择并发起识别时发送给配置的服务商。Android/iOS 使用 Capacitor 原生 HTTP，网页使用 fetch；网页仍受服务商的 CORS 配置约束。任意专有协议、自定义鉴权和仅支持 Responses 的接口未纳入本次适配。

## 国产视觉服务商

2026-10-05 按官方文档核验的可编辑预设：

| 服务商 | 默认地址 | 默认模型 | 请求适配 |
| --- | --- | --- | --- |
| [通义千问](https://help.aliyun.com/zh/model-studio/vision) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-vl-flash` | 混合思考模型使用 `enable_thinking: false` |
| [智谱 GLM](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v-flash` | `thinking.type: disabled`；JPG/PNG，最多 5 MB |
| [Kimi](https://platform.kimi.com/docs/guide/use-kimi-vision-model) | `https://api.moonshot.cn/v1` | `kimi-k2.6` | K2.6 使用 instant 模式，K3 使用 `reasoning_effort: low` |
| [豆包](https://docs.volcengine.com/docs/ark/image-understanding) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-1-pro-260628` | 支持已开通视觉模型或 `ep-` 接入点 ID；关闭深度思考 |

四家使用 OpenAI 兼容图片请求。服务商选择独立保存，改用代理地址后仍保留其参数；切换服务商会清空旧密钥。地址可按地域、工作空间调整，模型可从列表选择或手填，预设不保证用户账号已开通。通义旧 DashScope 地址仍兼容，详见[官方说明](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。Kimi 已退役模型不作为预设。

## 写入语义

- 按证券代码 + 市场匹配当前资产内的持仓。名称仅用于新建，不覆盖用户已有名称。支持 A 股、港股及美股的普通股票与 ETF；期权/期货排除。
- 不清空未出现的股票，不修改现金、其他证券资产、存款、基金等其他账户，不运行全账本恢复。
- 识别名称、代码、总持仓股数、当前报价及平均买入成本；未知/隐藏字段留空，不用可用股数代替持仓，不用市值或成本代替报价。
- 显示的摊薄成本或口径不明的成本需要核对；不会自动当作平均买入成本。明确币种不符的金额留空，不自动换算。
- 持仓股数与成本以校准锚点更新，保留原有交易、已实现盈亏、持仓 ID 与计划关联。原始 JSON/Excel 备份恢复包含锚点；自动快照升级到 schema 9，将校准标记为 `position_adjustment`，保留股数、成本锚点和成交编号。
- 买卖记录包含证券、方向、完整日期、数量、成交价和可见的唯一成交编号。模型按可见日期/时间排列先后；预览可以前移/后移成交。未知日期年份、委托成交状态均需核对。
- 成交按唯一成交编号或同日同方向同数量同价格的出现次数去重。多个相同条件的真实成交保留笔数；追加重叠截图的无编号成交需要人工核对。
- 原本手填的匿名成交在匹配到唯一成交编号时只补编号，避免下次把另一笔相同价格/数量成交错当成同一笔。
- 同批持仓 + 交易先录入真实成交，再校准最终持仓，防止重复增加股数。整批校验与账本写入在一个事务中，失败全部回滚。

## 明确限制

若历史卖出缺少足够的期初持仓/买入历史，会阻止写入；不会虚构初始买入、截断卖出或制造收益。同日已有成交或校准锚点导致新成交先后无法安全确定时，会要求核对历史与原校准记录后再导入。完整交易历史与单日成交顺序会影响平均成本和已实现盈亏。含新增校准记录的备份需要 1.5.0 或更新版本读取，旧版无法正确计算这些锚点。

模板会带出现有持仓；支持 XLSX/XLS/CSV、中英文表头、代码前导零。导入严格校验整批数据，并拒绝完整账本备份文件。模板或导入列表删行表示不更新该股票，清仓须明确设股数为 0。

## 验证证据

2026-10-05：`npm test` 158/158 通过，`npm run lint`、`npm run build`、Android `assembleDebug` 均通过；iOS 1.5.0/build 10 的版本与 42 项网页资源同步校验通过。

自动测试覆盖三种 API 的请求/响应、端点、鉴权、超时、异常响应、数字/日期、成本/币种/成交状态，及资产隔离、重复成交、原子回滚、持仓校准、期权批量修改倍率、计划关联和备份恢复。

浏览器验证用独立合成账本及模拟 API：批量股数/价格修改、上传截图→可编辑持仓及成交预览→确认写入、新增及更新同一资产、保留存款与另一证券账户、重启配置恢复、重复导入幂等、密钥不进入账本备份，四家国产预设、切换清空旧密钥、设置页保存/清除、从导入跳转设置并返回保留草稿均通过；390px 和 320px 页面无横向溢出、无页面异常。截图和 `browser-check.json` 位于本目录。模拟响应不代表真实模型识别准确率。

未提供真实视觉 API 密钥，未向实际收费模型发送截图；未验证不同券商真实截图的提取准确率，也未执行手机安装/覆盖更新测试。真实设备验证仍待执行；发布验证将在签名包生成后补充。

协议依据：[OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision)、[Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)、[Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision)。
