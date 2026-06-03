# Fortuna Google Play 上架清单

更新日期：2026-05-18

## 当前本地状态

- 包名：`com.fortuna.wealthtracker`
- App 名称：`Fortuna`
- 版本：`versionCode 1` / `versionName 1.0`
- `targetSdkVersion`：36，满足 Google Play 当前至少 API 35 的提交门槛。
- 已生成未正式签名的 AAB：`android/app/build/outputs/bundle/release/app-release.aab`
- Web build 通过：`npm run build`
- Capacitor 同步通过：`npx cap sync android`
- Android release bundle 构建通过：`JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew bundleRelease`
- `npm run lint` 仍有源码规则问题，需要上架前清理或调整规则。

## 还不能直接上传的原因

当前 AAB 未配置 release upload key。Play Console 新应用需要上传 Android App Bundle，且必须用 upload key 签名。项目已配置为从环境变量读取签名信息：

```bash
export FORTUNA_UPLOAD_KEYSTORE=/absolute/path/fortuna-upload-key.jks
export FORTUNA_UPLOAD_STORE_PASSWORD='...'
export FORTUNA_UPLOAD_KEY_ALIAS=fortuna-upload
export FORTUNA_UPLOAD_KEY_PASSWORD='...'

cd /Users/restartday/Documents/Fortuna/android
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew bundleRelease
```

生成 upload key 示例：

```bash
'/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool' -genkeypair \
  -v \
  -keystore /Users/restartday/Documents/Fortuna/fortuna-upload-key.jks \
  -alias fortuna-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

请把 `.jks` 和密码单独保存到密码管理器或安全位置，不要提交到仓库。

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
   - Data safety：需要填写。Fortuna 本地存储资产、负债、持仓、账户名称等金融信息，并会联网请求 frankfurter.dev 汇率接口。
   - Privacy policy：需要提供公开 URL，尤其因为涉及 financial info、calendar permission、share/export。
   - Financial features declaration：需要填写。定位为个人资产记录/投资组合追踪，不提供贷款、授信、证券交易执行、个性化金融建议。
   - Permissions declaration：当前 manifest 包含 `READ_CALENDAR` / `WRITE_CALENDAR`，用于用户主动创建还款提醒。若日历提醒不是首发核心功能，建议发布前移除日历权限，降低审核摩擦。
   - Content rating：按问卷填写，通常应为 Everyone。
   - Target audience：面向成人/普通用户，不面向儿童。

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

## 上架前建议处理

- 修复 lint：当前主要问题是 React Hooks 规则、`any` 类型、`ProductsPage` 的 unused expression。
- 确认是否保留日历权限：保留就要在商店说明和权限声明里讲清楚用途；不保留则首版更容易过审。
- 准备隐私政策页面：要覆盖本地 IndexedDB、导出文件、汇率 API、日历权限、无广告/无第三方分析 SDK。
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
