# Fortuna App Privacy Answers

Use this as a conservative draft for App Store Connect. Recheck it against the uploaded archive and each market-data provider's current retention practice on submission day.

## Tracking

- Does this app or its third-party partners use data for tracking? `No`
- Does the app use the Advertising Identifier or App Tracking Transparency? `No`

## Data Types to Declare

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

## Data Not Collected by Fortuna

- Other Financial Info: assets, debts, balances, quantities, trades, notes, and allocation plans stay local unless the user exports or shares them.
- Identifiers: no Fortuna account or device identifier is created.
- Usage Data and Diagnostics: no analytics or crash-reporting SDK is included.
- Contact Info: no login, name, email, or phone number is requested.
- Calendar Data: the user confirms the proposed event in Apple's system calendar sheet; it is not sent to a Fortuna server.

## App-Level Privacy Manifest

`ios/App/App/PrivacyInfo.xcprivacy` mirrors the conservative Coarse Location and Search History disclosures above. It declares no tracking and no required-reason API use by Fortuna code. Capacitor and CapacitorCordova include their own signed privacy manifests.

## Privacy URLs

- English: `https://charlotteamian.github.io/Fortuna/privacy-policy.html`
- Simplified Chinese: `https://charlotteamian.github.io/Fortuna/privacy-policy-zh.html`
- Privacy choices/support: `https://charlotteamian.github.io/Fortuna/support.html`
