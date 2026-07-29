# Privacy Policy for Fortuna

Effective date: 2026-07-29

Fortuna is a local-first personal asset, liability, holdings, and net-worth tracking app. This policy explains what the app stores, when it connects to other services, and what choices you have.

## Data Stored on Your Device

Fortuna stores the information you enter in the app's local IndexedDB database. This may include account and institution names, asset and liability categories, balances, holdings, security or fund codes, transactions, notes, currencies, product details, allocation plans, cached market data, and settings.

Fortuna does not require an account and does not operate a server that receives your asset database. Except for the limited transfers described below, the developer does not receive your financial records.

## Market Data and Exchange-Rate Requests

Fortuna can request public exchange rates, precious-metal prices, and market quotes. Requests may happen automatically when cached data is missing or stale or when you open a supported portfolio, and may also happen when you choose to refresh data.

Depending on the feature and instrument, the app may contact:

- Frankfurter (`api.frankfurter.dev`) for currency exchange rates;
- Gold API (`api.gold-api.com`) for precious-metal prices;
- Tencent (`qt.gtimg.cn`) for supported equity and exchange-traded security quotes;
- Eastmoney/Tiantian Fund (`fundgz.1234567.com.cn`) for supported fund estimates;
- Sina Finance (`hq.sinajs.cn`) for supported futures quotes; and
- Cboe (`cdn.cboe.com`) for delayed US equity-option quotes.

These requests send only the public identifiers needed for a lookup, such as currency or metal codes and fund, security, futures, option-underlying, or option-contract codes. They do not intentionally send your account names, balances, quantities, transaction history, or notes. As with any internet request, the receiving service can see ordinary connection information such as your IP address and request headers. Those services are independent of Fortuna and handle request data under their own terms and privacy practices.

## Calendar Reminders

If you choose to create a repayment reminder, Fortuna opens a system calendar prompt. The proposed calendar entry may include the account name and repayment date you entered. Nothing is added until you confirm through the device interface. Your calendar app or calendar provider may store or synchronize the resulting entry under its own privacy policy. Fortuna does not send calendar content to a developer-operated server.

## Exports, Imports, Sharing, and Automatic Snapshots

Manual reports and backups are created only when you request them. On Android and iOS, Fortuna may place a temporary export in app cache and open the system share sheet; on the web it may start a download. Any app, storage provider, or person you select can then receive and process the file. Imported backups are read only after you select a file and are restored into the local database.

On Android, the optional automatic JSON snapshot is disabled until you choose a destination directory and grant persistent access through the system directory picker. Once enabled, Fortuna can update a full snapshot after relevant changes and when the app moves to the background. A selected cloud-backed directory may synchronize the snapshot through its storage provider. Disconnecting the directory stops future writes and revokes Fortuna's retained access, but it does not delete snapshot files that have already been created. Automatic folder snapshots are not available on iOS; iOS users can export an Excel backup or report through the system share sheet.

Exports and snapshots can contain sensitive financial information in readable form. Store and share them carefully.

## Device and System Backups

Android or iOS may back up and later restore some local app-container data, potentially including the IndexedDB database, according to your device, account, and system backup settings. This is controlled by the operating system and backup provider, not by Fortuna's developer. Review your Android backup or iCloud Backup settings if you do not want this behavior.

## Data Sharing and Advertising

Fortuna does not sell personal data and does not include advertising or analytics SDKs. The developer does not receive your locally stored asset database. Data can leave the app only through the market-data requests, system calendar, user-authorized exports or snapshot destination, and operating-system backup paths described above.

## Retention and Deletion

Local records remain on the device until you delete them in the app, clear the app's storage, or uninstall the app. Clearing storage or uninstalling can permanently remove records that you have not exported. Android or iOS may restore previously backed-up data after reinstalling, depending on system settings.

Deleting local data does not remove copies in exported files, automatic snapshots, calendar entries, shared destinations, or system/cloud backups. Delete those copies separately in the relevant app or service. Disconnecting an automatic snapshot directory does not delete existing snapshot files.

Fortuna does not maintain a server-side account or server-side asset database to delete. Third-party market-data services may retain connection or request information according to their own policies.

## Security

Market-data requests use HTTPS. Local data is protected by the security controls of your device; Fortuna does not add a separate database password or end-to-end encryption layer. Use a device passcode or biometric lock and keep exported files and selected snapshot directories secure.

## Financial Disclaimer

Fortuna is an informational record-keeping tool. It does not provide loans, credit, brokerage, securities or crypto trading, or personalized financial or investment advice. Quotes and calculations may be delayed, incomplete, or inaccurate. Verify important figures independently before making a financial decision.

## Changes

This policy may be updated when the app's data practices or features change. The current version will be published at the privacy-policy URL used in the app and its store listing.

## Contact

For privacy questions and the current support route, open Fortuna and go to **Settings → About**.
