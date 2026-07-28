# Play Console App Content Answers

Last verified against the Fortuna source: 2026-07-28.

Play Console wording changes over time. Re-check the released AAB and the current form before submitting. Do not reuse the earlier `No data collected/shared` answer: Fortuna now sends user-entered market identifiers to independent quote services, including during automatic refreshes.

## App Access

- Does the app require users to log in? `No`

Reviewer note:

```text
No login is required. Reviewers can open Fortuna and use all core features immediately. Financial records are stored in the app's local IndexedDB database.
```

## Ads

- Does the app contain ads? `No`

Fortuna currently includes no advertising or analytics SDKs.

## Content Rating and Audience

- Violence, sexual content, profanity, controlled substances, public user-generated content, gambling, and location sharing: `No`
- Target age group: `18 and over`
- Designed for children: `No`

Fortuna is a personal financial record-keeping tool and is not designed for children.

## Data Safety

Google defines collection as transmitting user data off the device, including transmission to a third-party server and ephemeral processing. Locally processed IndexedDB data is outside that definition. Google also says inferred approximate location, including location inferred from an IP address, must be declared according to how the recipient uses it. See [Google Play's Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469).

### Data that stays on the device

Account names, institutions, balances, quantities, transactions, notes, allocation plans, settings, and the full local database are not sent to a developer-operated server. Do not declare these as collected merely because they are stored in IndexedDB.

### Network requests that leave the device

Fortuna can contact the following HTTPS services automatically or after a manual refresh:

- `api.frankfurter.dev`: currency codes;
- `api.gold-api.com`: metal and currency codes;
- `qt.gtimg.cn`: equity and exchange-traded security codes;
- `fundgz.1234567.com.cn`: fund codes;
- `hq.sinajs.cn`: futures codes; and
- `cdn.cboe.com`: US option-underlying or contract lookup identifiers.

The services also receive ordinary connection metadata such as the device's IP address and HTTP request headers. Fortuna does not intentionally include account labels, balances, quantities, transactions, or notes in these requests.

### Conservative form answers for the current build

- Does the app collect or share any required user data types? `Yes`
- Data type: `Financial info → Other financial info`
  - Reason: a security, fund, futures, or option identifier can describe a user-entered holding and is transmitted for quote lookup.
  - Collected: `Yes`
  - Shared: `Yes`, unless the publisher has current evidence that a Google sharing exception applies to every provider.
  - Purpose: `App functionality`
  - Optional: `Yes`; users can omit market identifiers and maintain prices manually.
  - Ephemeral processing: do not select `Yes` without provider documentation that the data is retained only in memory for the live request.
- Approximate location:
  - Fortuna does not request Android location permission or send a location field.
  - Confirm each provider's current handling of IP addresses. If a provider retains or uses the IP to infer location, declare `Location → Approximate location` for app functionality. Do not guess or claim the provider discards it without evidence.
- Is all collected data encrypted in transit? `Yes` for the app's current network endpoints; they use HTTPS.
- Data deletion request mechanism:
  - Users can delete local records, clear app storage, or uninstall without making a request.
  - Fortuna has no server account or developer-held asset database.
  - Do not claim a developer-side deletion-request service unless one is actually introduced. Third-party request retention and deletion are governed by the relevant provider.

### Transfers normally handled outside the core collection answer

- A manual export or share goes only to the destination the user selects. Google provides a specific example that a direct user-selected upload to the user's own Drive or Dropbox account is not app collection when the developer does not access it.
- An automatic JSON snapshot is disabled until the user selects a directory through Android's system picker and grants persistent access. If the selected directory is cloud-backed, that storage provider may synchronize the file.
- A calendar reminder is created only after the user confirms the system calendar prompt. The entry may contain the account name and repayment date and may be synchronized by the user's calendar provider.
- Android system backup may back up and restore local app data because the current application configuration permits backup.

These paths are fully disclosed in the privacy policy even when a user-initiated-transfer or system-service exclusion means they do not need to be labelled as collection or sharing in the Data safety form. Re-evaluate if the implementation or Google's definitions change.

## Financial Features Declaration

- App category: `Finance`
- Does the app provide financial features? `Yes`
- Select the closest available categories for `Budgeting and personal finance management`, `Expense tracking`, and/or `Portfolio tracking`.
- Personal loans, lending leads, credit brokerage, or lender connection: `No`
- Securities, crypto, or financial-product trading: `No`
- Personalized financial or investment advice: `No`

Reviewer note:

```text
Fortuna is a local-first personal asset and liability record-keeping tool. It does not offer loans, credit, lending leads, brokerage, securities or crypto trading, bank-account connectivity, or personalized financial or investment advice. Market quotes are informational and may be delayed or inaccurate.
```

## Permissions Declaration

Current manifest permissions:

- `INTERNET`: retrieves public exchange rates, precious-metal prices, and supported market quotes.
- `READ_CALENDAR` and `WRITE_CALENDAR`: the implemented flow opens a system prompt only after the user chooses to add a repayment reminder. The app does not scan, upload, or send calendar data to a developer server.

Suggested explanation:

```text
Calendar access supports an optional, user-initiated repayment reminder. Fortuna opens the device's calendar prompt with the proposed account label and repayment date, and no entry is created until the user confirms. The app does not scan or upload calendar contents. A calendar provider may synchronize a confirmed entry under the user's calendar settings.
```

If Play Console rejects calendar access, remove unused calendar permissions or defer the reminder feature before release; do not submit a permission declaration that describes behavior the AAB does not contain.

## Privacy Policy URL

Host the generated HTML at a stable, public, non-geofenced URL and use that exact URL in Play Console and in the app:

- `public/privacy-policy.html`
- release copies: `release/play-store/privacy-policy.html` and `release/play-store/privacy-policy.md`

The policy contains no placeholder identity or invented email. The current contact route is **Settings → About** inside Fortuna. Ensure that screen exposes the published policy and a working support route before production submission.
