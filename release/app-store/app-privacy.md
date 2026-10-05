# Fortuna App Privacy Answers

Last reviewed against the source: 2026-10-05. Use this as a conservative draft for App Store Connect. Recheck it against the uploaded archive and each market-data or user-selected recognition provider's current retention practice on submission day. The GitHub release does not submit or approve App Store privacy answers.

## Tracking

- Does this app or its third-party partners use data for tracking? `No`
- Does the app use the Advertising Identifier or App Tracking Transparency? `No`

These existing answers describe Fortuna's source and public quote integration. The app adds no advertising, analytics, or tracking SDK for recognition; verify the selected recognition services' actual data use before applying an answer to third-party practices at store submission.

## Data Types to Declare

The following existing answers describe public quote lookups. They do not settle the additional disclosures needed for optional screenshot recognition.

### Coarse Location

- Collected: `Yes, conservatively`
- Linked to the user's identity: `No`
- Used for tracking: `No`
- Purpose: `App Functionality`
- Reason: independent quote services receive the ordinary network IP address. If every provider confirms it discards IP data immediately after servicing the request, Apple permits this disclosure to be removed.

### Search History

- Collected: `Yes, conservatively`
- Linked to the user's identity: `No`
- Used for tracking: `No`
- Purpose: `App Functionality`
- Reason: currency, metal, fund, security, futures, and option identifiers are transmitted to fulfil quote lookups. No Fortuna account ID, balance, quantity, trade history, or note is sent.

## Optional Screenshot Recognition: Submission Audit Required

The user can configure a domestic or other compatible vision API and select a brokerage screenshot. The complete selected image is sent directly to that configured provider with extraction instructions and API authentication. It may expose account labels, balances, securities, quantities, prices, costs, transaction dates, and execution references visible in the image. The provider can return holdings and completed transactions for local review; confirmation changes only the selected stock/ETF account. Fortuna operates no recognition backend and does not attach the full asset database or upload screenshots automatically.

The API address, model, and key stay in a separate local IndexedDB database and are excluded from ledger backups and automatic asset snapshots. The selected provider controls its own billing, retention, privacy practices, and deletion process; its API authentication may associate requests with that provider account.

Before App Store submission, audit the image content actually transmitted, the supported providers' retention and identity-linking practices, and the current questionnaire. Evaluate financial information, submitted images/content, visible identifiers, and ordinary connection metadata; do not mark them universally uncollected or unlinked just because Fortuna has no server. An optional user action alone does not establish Apple's disclosure exception. These are audit items, not finalized store labels. See [Apple's App Privacy guidance](https://developer.apple.com/app-store/app-privacy-details/).

## Local Storage and Other Data Practices

- Other Financial Info: the full asset ledger is stored locally. User-selected recognition screenshots can transmit visible financial information to the selected provider; user-authorized exports, snapshots, sharing, and system backups can also transfer data.
- Identifiers: no Fortuna account or device identifier is created.
- Usage Data and Diagnostics: no analytics or crash-reporting SDK is included.
- Contact Info: no login, name, email, or phone number is requested.
- Calendar Data: the user confirms the proposed event in Apple's system calendar sheet; it is not sent to a Fortuna server.

## App-Level Privacy Manifest

`ios/App/App/PrivacyInfo.xcprivacy` currently mirrors the earlier conservative Coarse Location and Search History quote disclosures above. It declares no tracking and no required-reason API use by Fortuna code. Capacitor and CapacitorCordova include their own signed privacy manifests. The optional recognition data flow requires a fresh manifest and App Store Connect submission audit; the existing manifest is not evidence that those provider-dependent answers are complete.

## Privacy URLs

- English: `https://charlotteamian.github.io/Fortuna/privacy-policy.html`
- Simplified Chinese: `https://charlotteamian.github.io/Fortuna/privacy-policy-zh.html`
- Privacy choices/support: `https://charlotteamian.github.io/Fortuna/support.html`
