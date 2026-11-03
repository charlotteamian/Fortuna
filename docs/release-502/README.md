# Fortuna 5.0.2 发布验证

2026-11-03，发布分支 `codex/release-5.0.2`，Android versionCode 39。基线为已发布 5.0.1 的后续验证提交 `5a1f621`。

按用户选择保留 5.0.1 全部功能及修复，再合入 `workbuddy/main-ce1e4e2e` 当前未提交的六个文件改动。原工作区及 `.workbuddy/` 保留，导入源文件 SHA-256 见 `source-snapshot.json`。

本次包括股票／基金切换、持仓和价格触发统计、预算及刷新进度、未分配股票直接设置占比、列表二次确认移除、两步编辑，以及网格定价公式和折叠参考指标。合并时保留了统一状态、紧凑列表、原网格及证据、编辑指纹冲突保护、预览确认和今日检查的跨日及批次所有权保护。检查依据链接能切换到对应股票／基金页面。

必要衔接：触发统计及定价表读取既有报价校验结果，缺价、过期或冲突时不生成确定性触发状态；直接分配只更改所选股票权重，并在同一数据库事务核对总额度，避免并发超配。定价公式、税率、网格算法、基金条件、主数据库和备份格式未更改。

验证材料：

- `verification.json`：813 项测试通过（保留原 809 项，新增四项分配与并发保护）；lint、生产构建、Android 同步和 16 项原生更新器单测通过。
- `browser-validation.json`：八项新流程检查及 12 组布局检查，覆盖 320/390 px 和 1/1.3 倍字号；页面错误 0。
- `stage3/browser-validation.json`：沿用 5.0.1 今日检查回归，并补充跨股票／基金页面的原依据跳转；独立 Chrome、固定模拟数据、HTTP/模型 stub，未访问真实用户数据库。
- GitHub 签名构建、下载包校验与应用更新解析器结果将在发布后记录于 `release-verification.json`。

正式发布说明位于 `release/github/v5.0.2.md`。iOS 只同步版本元数据为 5.0.2/build 39，本次不交付 iOS 安装包。实体设备安装及升级保留数据、真实市场服务及真实模型均未验收。

复跑：启动 `npm run dev -- --host 127.0.0.1 --port 5192 --strictPort`，再执行 `node docs/release-502/validate-browser.mjs` 及 `FORTUNA_STAGE3_ORIGIN=http://127.0.0.1:5192 node docs/release-502/stage3/validate-browser.mjs`。

发布已完成：标签 `v5.0.2` 指向 `2c3caf6`，代码推送至 `codex/release-5.0.2`；[GitHub 签名构建](https://github.com/charlotteamian/Fortuna/actions/runs/41555796119)成功，[正式发布页](https://github.com/charlotteamian/Fortuna/releases/tag/v5.0.2)已成为 latest。未合并 main，原 WorkBuddy 工作区未改写。

下载 APK 为 6,037,733 字节，SHA-256 为 `95cd08e5a1aea309ef9ef6a017545634569e4db56d070b5cd26839f891f8640a`。包名、5.0.2/versionCode 39、长期证书均一致；48 个网页文件和两个 Capacitor 桥接文件与本地已验证构建逐字节相同。应用原更新解析器使用实际发布数据，可从 5.0.0/5.0.1 识别更新，5.0.2 不重复提示。完整证据见 `release-verification.json`。
