# Fortuna Google Play 上架清单

更新日期：2026-08-02

## 当前本地状态

- 包名：`com.fortuna.wealthtracker`
- App 名称：`Fortuna`
- 版本：`versionCode 5` / `versionName 1.3.0`
- `targetSdkVersion`：36；这也满足 2026-08-31 起新 app 和更新需面向 Android 16 / API 36 的要求（提交当天仍应复核官方政策）。
- Web 单元/回归测试、TypeScript、ESLint、Vite build、Capacitor 同步和 Android 构建状态应以每次待发布提交的实际 CI/本地结果为准，不复用旧产物结论。
- 正式 AAB 必须在最终代码上重新生成，并使用开发者自己的 upload key 签名；不要把旧的 debug APK 当作商店发布包。

## 签名状态与构建

Fortuna 已从 1.3.0 起建立固定 release/upload key。GitHub Actions 的密钥内容保存在仓库 Secrets，本地密钥与密码保存在仓库外；不要重新生成另一把 key。项目从以下环境变量读取签名信息：

```bash
export FORTUNA_UPLOAD_KEYSTORE=/absolute/path/fortuna-upload-key.jks
export FORTUNA_UPLOAD_STORE_PASSWORD='...'
export FORTUNA_UPLOAD_KEY_ALIAS=fortuna-release
export FORTUNA_UPLOAD_KEY_PASSWORD='...'

cd /path/to/Fortuna/android
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew bundleRelease
```

公开证书 SHA-256 为 `b6898c38efabded0a7a2826ff1b83c5191b3d3be7f0723201984ecd0fc8cf62c`，CI 会与 `android/release-signing-cert.sha256` 核对。请把 `.jks` 和密码分别备份到安全位置，不要提交到仓库。详细说明见 `docs/android-signing.md`。

## Play Console 流程

1. 创建 app
   - App name：`Fortuna`
   - Default language：建议 `Chinese (Simplified)` 或按目标市场选择
   - App or game：App
   - Free or paid：按实际选择，个人资产管理工具建议先免费
   - Category：Finance

2. App integrity / Play App Signing
   - 新应用使用 Play App Signing。
   - 上传本地 upload key 签过的 `.aab`。
   - 之后更新必须继续用同一个 upload key。

3. 测试轨道
   - 建议先 Internal testing 上传。
   - 如果是 2023-11-13 之后创建的个人开发者账号，生产发布前需要 Closed testing：至少 12 个 tester 连续 opt-in 14 天。

4. App content
   - Data safety：需要填写。账本主要保存在本地；汇率、贵金属和行情功能仍会把查询所需的公开市场标识及常规连接元数据发送给独立服务。按 `release/play-store/data-safety-and-policy-answers.md` 与最终 AAB 复核。
   - Privacy policy：需要提供公开 URL，尤其因为涉及 financial info、calendar permission、share/export。
   - Financial features declaration：需要填写。定位为个人资产记录/投资组合追踪，不提供贷款、授信、证券交易执行、个性化金融建议。
   - Permissions declaration：当前 manifest 包含 `READ_CALENDAR` / `WRITE_CALENDAR`，用于用户主动创建还款提醒。若日历提醒不是首发核心功能，建议发布前移除日历权限，降低审核摩擦。
   - GitHub 侧载版还包含 `REQUEST_INSTALL_PACKAGES`，用于 App 内安装已验证更新。Google Play 对该权限限制严格；提交 Play 前应单独评估政策资格，必要时用 Play 专用构建移除 App 内 APK 安装能力并改用 Play 更新。
   - Content rating：按当前问卷和实际功能如实填写，不预设评级结果。
   - Target audience：定位为 `18 and over`，不面向儿童。

5. Store listing
   - Short description：最多 80 字符。
   - Full description：说明本地资产追踪、净值图表、Excel/JSON 导出、汇率更新。
   - High-res icon：512x512 PNG。
   - Feature graphic：1024x500。
   - Phone screenshots：至少 2 张，建议 4-6 张：首页资产、净值图、账户详情、设置/导出。
   - 联系邮箱：需要一个可公开展示的支持邮箱。

6. 发布
   - Internal testing 通过安装验证后，再推 Closed testing 或 Production。
   - 生产发布前检查 Play Console 的 Policy status / App content 是否全绿。

## 上架前必须复核

- 在最终提交上重新运行全部测试、ESLint、Web build、Capacitor sync 和 Android release build，并保留结果。
- 确认是否保留日历权限：保留就要在商店说明和权限声明里讲清楚用途；不保留则首版更容易过审。
- 托管并核对隐私政策页面：必须覆盖本地 IndexedDB、行情服务、系统备份、导入导出、自动快照、日历权限及无广告/无第三方分析 SDK。
- 准备测试账号/测试数据说明：Fortuna 不需要登录，但可以在审核备注说明“无需账号，首次打开即可使用”。

## 官方参考

- Target API requirement: https://developer.android.com/google/play/requirements/target-sdk
- Prepare and roll out a release: https://support.google.com/googleplay/android-developer/answer/9859348
- Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756
- Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469
- User data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Financial services policy: https://support.google.com/googleplay/android-developer/answer/16322411
- Preview assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Personal account testing requirement: https://support.google.com/googleplay/android-developer/answer/14151465
