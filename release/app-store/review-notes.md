# Fortuna App Review Notes

```text
Fortuna is a local-first personal record-keeping app. No login, review account, financial institution connection, subscription, in-app purchase, or external hardware is required.

Core review path:
1. Launch the app and complete or skip onboarding.
2. Add an asset or liability from the Assets tab.
3. Open the account to add records or portfolio holdings.
4. Use Charts and Plan with locally entered data.
5. Open Settings to export an Excel backup, view the in-app privacy policy, or create an optional calendar reminder from an eligible credit-card account.

The app does not move money, connect to bank or brokerage accounts, execute trades, provide loans or credit, custody cryptocurrency, or provide personalised financial advice. It is a user-entered ledger and estimation tool.

Financial records are stored in local IndexedDB. The developer does not operate an account, asset database, or screenshot-recognition backend. Public market identifiers may be sent to independent quote providers to return a requested price; those quote requests do not intentionally include account names, balances, quantities, transaction history, or notes. Separately, optional screenshot recognition sends the complete user-selected image and extraction instructions directly to the vision API provider configured by the user, so financial details and identifiers visible in that image can be transmitted. The provider may require its own API key/account and charge for usage. The app does not automatically upload screenshots or attach the full local asset database; reviewers can use manual entry or local Excel holdings imports without a vision API. The app includes no advertising, analytics SDK, or cross-app tracking.

Recognition results are shown for review before confirmation changes the selected stock/ETF account. Other accounts and asset types are not replaced. API configuration and keys are stored in a separate local IndexedDB database, excluded from ledger backups and automatic asset snapshots; provider retention, billing, privacy, and deletion are governed by the chosen service. Re-audit the App Store privacy questionnaire and manifest for this optional provider-dependent transfer before a store submission; the GitHub release does not finalize those declarations.

Calendar reminders use Apple's system confirmation interface and are created only after the reviewer confirms. Denying calendar access does not block any core ledger feature.

Automatic folder snapshots are Android-only. On iOS the setting explains this limitation and directs users to Excel backup and the iOS share sheet. All other current business features share the same React/Dexie production bundle as Android and the web build.

App version: 1.3.0
Bundle ID: com.fortuna.wealthtracker
```

Before submission, attach documentation or a short explanation for the permitted use of each third-party quote service if App Review asks under Guideline 5.2.2. Do not claim rights that have not been confirmed.
