# Fortuna 新手上架步骤

你照这个顺序做。不要跳步骤。

## 0. 你需要先准备的东西

1. Google Play Developer 账号  
   地址：https://play.google.com/console

2. 一个真实、可长期维护的公开支持邮箱。这个邮箱会显示在商店页；不要在仓库里提交占位地址。

3. 一个公开隐私政策 URL  
   我已经生成了隐私政策文件：
   - `release/play-store/privacy-policy.html`
   - `release/play-store/privacy-policy.md`
   - `public/privacy-policy.html`

   当前政策没有虚构开发者身份或邮箱，支持入口统一指向应用内“设置 → 关于”。提交前仍需逐项核对政策与当前 AAB，并把政策公开托管。常见方案：
   - Google Sites 新建一个页面，复制隐私政策内容，发布后拿 URL。
   - 或 Notion 页面 Share to web。
   - 或 GitHub Pages。

4. 如果你的 Play Console 是 2023-11-13 后创建的个人账号：准备至少 12 个测试者 Gmail。  
   他们需要连续 14 天 opt-in closed testing。

## 1. 核对并托管隐私政策

打开：

```text
release/play-store/privacy-policy.html
release/play-store/privacy-policy.md
public/privacy-policy.html
```

确认三份内容一致、没有占位信息，并与当前发布包的数据实践相符。在 Play Console 填写真实支持邮箱；如果应用内增加邮件入口，也必须使用同一个可维护地址。

## 2. 生成 upload key

在项目根目录运行：

```bash
bash scripts/create-upload-key.sh
```

它会让你输入密码和证书信息：

- keystore password：自己设一个强密码，保存到密码管理器。
- key password：可以和 keystore password 相同，也保存。
- first and last name：可以填你的开发者名。
- organizational unit：可留空或填 `Personal`
- organization：可留空或填你的开发者名。
- city/state/country：按实际填。
- 确认 `yes`。

生成后会得到：

```text
fortuna-upload-key.jks
```

非常重要：这个文件和密码以后每次更新 app 都要用。丢了会很麻烦。不要上传到 GitHub，不要发给别人。

## 3. 用 upload key 生成正式 AAB

把你刚才的密码填进环境变量：

```bash
export FORTUNA_UPLOAD_KEYSTORE='/absolute/path/to/fortuna-upload-key.jks'
export FORTUNA_UPLOAD_STORE_PASSWORD='你刚才设置的 keystore password'
export FORTUNA_UPLOAD_KEY_ALIAS='fortuna-upload'
export FORTUNA_UPLOAD_KEY_PASSWORD='你刚才设置的 key password'
```

然后运行：

```bash
bash scripts/build-release-aab.sh
```

成功后上传这个文件：

```text
android/app/build/outputs/bundle/release/app-release.aab
```

## 4. 打开 Play Console 创建 App

进入：https://play.google.com/console

点：

```text
All apps -> Create app
```

填写：

- App name: `Fortuna`
- Default language: `Chinese (Simplified)` 或 `English (United States)`
- App or game: `App`
- Free or paid: `Free`
- 勾选确认政策。

## 5. Main Store Listing

位置：

```text
Grow users -> Store presence -> Main store listing
```

照着复制：

```text
release/play-store/store-listing.md
```

上传素材：

```text
release/play-store/assets/icon-512.png
release/play-store/assets/feature-graphic-1024x500.png
release/play-store/assets/phone-01-overview.png
release/play-store/assets/phone-02-charts.png
release/play-store/assets/phone-03-account.png
```

## 6. App Content

位置一般在：

```text
Policy and programs -> App content
```

照着这个文件填：

```text
release/play-store/data-safety-and-policy-answers.md
```

重点：

- Ads: `No`
- App access: `No login required`
- Data safety: 不要选择旧版的 `No data collected/shared`。行情请求会把用户输入的公开市场标识发送给独立数据服务；按 `data-safety-and-policy-answers.md` 的保守口径填写，并在提交当日复核服务商实践与 Google 定义。
- Financial features: 选择个人财务/资产追踪相关；贷款、交易、个性化建议全部选 `No`。
- Target audience: `18 and over`
- Privacy policy URL: 填你公开托管后的隐私政策 URL。

## 7. 创建 Internal Testing Release

位置：

```text
Test and release -> Testing -> Internal testing
```

操作：

1. Create new release
2. 选择 Play App Signing，接受条款。
3. 上传正式签名的 `app-release.aab`
4. Release name: `1.3.0`
5. Release notes:

```text
Adds independent account inclusion and hiding controls, permanent release signing for the GitHub channel, and a security-checked Android update flow while preserving Fortuna's local-first ledger and backups.
```

6. Save -> Review release -> Start rollout to Internal testing

## 8. 添加测试者

Internal testing 可以只加你自己的 Gmail。

如果需要 Closed testing：

位置：

```text
Test and release -> Testing -> Closed testing
```

操作：

1. Create track
2. Testers -> Create email list
3. 加入至少 12 个 Gmail
4. 上传同一个 AAB 或新版本 AAB
5. Start rollout
6. 把 opt-in link 发给测试者

测试者需要：

1. 用被加入名单的 Gmail 打开 opt-in link。
2. 点 Become a tester。
3. 从 Play Store 安装 Fortuna。
4. 连续 14 天不要退出测试。

## 9. 申请 Production

如果你的账号不需要 12 测试者流程，可以直接：

```text
Test and release -> Production -> Create new release
```

如果你的账号需要测试流程，则 12 个测试者连续 14 天后：

```text
Dashboard -> Apply for production access
```

回答重点：

```text
Fortuna was tested for core flows: creating accounts, adding records, viewing net worth charts, exporting backups, refreshing exchange rates, and using optional calendar reminders. The app does not require login and stores records locally.
```

## 10. 审核中常见卡点

1. 隐私政策、Data safety 与 AAB 行为不一致
   解决：发布前按实际网络请求、系统备份、日历、导出和自动快照逐项复核；不要复用旧版“完全不收集/共享”的答案。

2. AAB 未签名或签名不对  
   解决：用 `scripts/build-release-aab.sh` 生成，不要上传 debug APK。

3. 金融政策误判为贷款 app  
   解决：商店描述和声明里明确写 `does not offer loans, credit, brokerage, trading, or personalized financial advice`。

4. Calendar 权限被追问  
   解决：说明仅用于用户主动添加信用卡还款提醒；如果仍卡住，发一个去掉日历功能的 v1。
