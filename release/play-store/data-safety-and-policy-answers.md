# Play Console App Content Answers

这些是你在 Play Console 里可以照着填的答案。因为 Console 会根据选项动态展开，下面按页面分组写。

## App Access

- Does your app require users to log in?
  - Answer: `No`

Reviewer note:

```text
No login is required. Reviewers can open Fortuna and use the app immediately. All user-entered asset records are stored locally on the device.
```

## Ads

- Does your app contain ads?
  - Answer: `No`

## Content Rating

建议按问卷实际回答：

- Violence: `No`
- Sexual content: `No`
- Profanity: `No`
- Controlled substances: `No`
- User-generated content/shared public content: `No`
- Online purchase/digital goods: `No`
- Gambling: `No`
- Location sharing: `No`

通常结果应为 `Everyone` 或相近低年龄分级。

## Target Audience

- Target age group: 建议选择 `18 and over`
- Not designed for children.

理由：这是个人资产/财富追踪工具，涉及金融信息，不应定位儿童用户。

## Data Safety

Fortuna 当前设计是本地优先：不登录、不上传资产记录、不接入广告/分析 SDK。Play Data safety 中的 “Collected” 通常指数据从用户设备传输给开发者或第三方服务。Fortuna 的资产记录只存在本地 IndexedDB；用户主动导出/系统分享属于用户发起的设备操作。

推荐填写：

- Does your app collect or share any of the required user data types?
  - Answer: `No`

如果 Play Console 追问网络：

```text
The app uses HTTPS requests to frankfurter.dev only to retrieve public exchange-rate data. It does not send user-entered account names, balances, transactions, holdings, identifiers, or contact information to the developer.
```

Security practices:

- Is all user data collected by your app encrypted in transit?
  - 如果上一题选 `No data collected`，可能不会出现。
  - 如果出现，答：`Yes`。汇率接口使用 HTTPS。
- Do you provide a way for users to request that their data is deleted?
  - 如果出现，说明：`Users can delete their locally stored records in the app or uninstall the app to remove local app data. Fortuna does not operate user accounts or cloud storage.`

## Financial Features Declaration

Play Console 要求所有已发布应用都填写金融功能声明。

推荐选择：

- App category: `Finance`
- Does the app provide financial features?
  - Answer: `Yes`
- Select features:
  - 选择最接近的：`Budgeting and personal finance management` / `Expense tracking` / `Portfolio tracking`（Console 具体选项可能略有差异）
- Personal loans:
  - Answer: `No`
- Is your app a personal loan app, lead generator, broker, aggregator, or connects users with third-party lenders?
  - Answer: `No`
- Does your app allow users to trade securities, crypto, or financial products?
  - Answer: `No`
- Does your app provide personalized financial advice?
  - Answer: `No`

Policy note / Review note:

```text
Fortuna is a local-first personal asset and liability tracking tool. It does not offer loans, credit, lending leads, brokerage, securities trading, crypto trading, bank account connectivity, or personalized financial advice. Users manually enter their own records for private tracking.
```

## Permissions Declaration

Current permissions:

- `INTERNET`: used to fetch exchange rates.
- `READ_CALENDAR` and `WRITE_CALENDAR`: used only when the user chooses to add an optional credit card repayment reminder to the system calendar.

Suggested explanation:

```text
Calendar access is used only for an optional user-initiated feature: adding credit card repayment reminders to the device calendar. Fortuna does not read or upload calendar data. The feature is triggered only after the user taps the reminder button and confirms the action.
```

If Google flags calendar permissions heavily, consider publishing v1 without the calendar reminder feature and removing both calendar permissions.

## Privacy Policy URL

You must provide a public URL. Use the generated policy in:

- `release/play-store/privacy-policy.md`
- `release/play-store/privacy-policy.html`

You still need to host it publicly, for example with GitHub Pages, Google Sites, Notion public page, or your own website.

