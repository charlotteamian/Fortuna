# Fortuna iOS / App Store 上架步骤

## 1. 上架前硬门槛

1. Apple Developer Program 会员有效，Xcode 登录了对应账号。
2. Bundle ID `com.fortuna.wealthtracker` 已在开发者后台注册，并属于 Team `X6M6J8N84C`。
3. App Store Connect 已创建 Fortuna App 记录，Bundle ID 与 Xcode 完全一致。
4. 已准备真实、长期可维护的 App Review 联系方式和支持联系方式。
5. 三个公开 HTTPS 页面可访问：
   - `https://charlotteamian.github.io/Fortuna/privacy-policy.html`
   - `https://charlotteamian.github.io/Fortuna/privacy-policy-zh.html`
   - `https://charlotteamian.github.io/Fortuna/support.html`
6. 对所有第三方行情接口的 App Store 分发使用权限做过书面核对。Apple Guideline 5.2.2 要求第三方服务内容必须得到其条款明确允许。

## 2. 生成候选 Archive

每次上传必须增加 build number。当前 1.3.0 候选使用 build 3；如果 App Store Connect 已存在 build 3，则改用更大的整数。

```bash
export FORTUNA_IOS_BUILD_NUMBER=3
npm run archive:ios
```

脚本会依次：

- 运行全部业务与发布脚本测试；
- 运行 ESLint 和 TypeScript/Vite 生产构建；
- 将 `package.json` 的 `1.3.0` 同步到 Xcode；
- 执行 `cap sync ios`；
- 逐文件校验 `dist/` 与 iOS 内置 `public/`；
- 用自动签名生成 `build/Fortuna.xcarchive`。

## 3. Xcode 验证与上传

1. 打开 Xcode → Window → Organizer → Archives。
2. 选中 Fortuna Archive，先执行 Validate App。
3. 检查：版本 `1.3.0`、build number、Bundle ID、签名 Team、App Icon、隐私清单均正确。
4. 选择 Distribute App → App Store Connect → Upload。
5. 等待 App Store Connect 处理完成；有 warning 也要逐条阅读，不要只看“Complete”。

## 4. TestFlight

1. 先加入自己的 Apple ID 做 Internal Testing。
2. 在至少一台真实 iPhone 上从 TestFlight 全新安装。
3. 使用纯模拟数据验证：首次启动、添加账户、添加持仓和交易、行情失败兜底、图表、计划、金额隐藏、Excel 导入导出、系统分享、日历拒绝/允许、深浅色、中文/英文、大字体、后台恢复。
4. 卸载前验证备份可恢复；不要用真实财务数据作为审核演示数据。

## 5. App Store Connect 填写

- 商店文案：`release/app-store/store-listing.md`
- 隐私问卷：`release/app-store/app-privacy.md`
- 审核说明：`release/app-store/review-notes.md`
- 加密：App 只使用系统提供的标准 HTTPS，工程声明 `ITSAppUsesNonExemptEncryption = NO`；如后续加入自定义加密必须重新评估。
- 内容权利：如果 App 显示第三方行情，必须如实回答并保留许可证据。
- 年龄分级：按实际问卷回答；不要勾选 Made for Kids。
- 价格：Free；无 IAP。

## 6. 截图

当前工程是 iPhone-only，竖屏。使用 Xcode 26 的 6.9 英寸 iPhone 模拟器或真机，以 `demo/` 的纯模拟数据重新截取中文和英文画面。每种语言建议 4 张：

1. 全资产总览；
2. 组合账户与持仓；
3. 资产配置计划；
4. 趋势与结构图表。

不要直接提交现有 `docs/screenshots/`：它们是 1080×2400 且带 alpha，必须重新捕获为 Apple 接受的尺寸且不得包含透明通道。提交当天以 Apple Screenshot Specifications 页面为准。

## 7. 提交审核前最后检查

- Git 工作区中的候选代码有明确 commit/tag；
- GitHub `iOS Release Readiness` 工作流通过；
- TestFlight 真机回归通过；
- 隐私政策与实际二进制一致；
- 行情服务权利与隐私保留实践已核对；
- Support URL、Privacy URL、审核联系方式可用；
- 手动发布（Manual release），先避免审核通过后自动上线。
