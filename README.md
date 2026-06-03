# Fortuna

Fortuna is a source-available, local-first personal wealth tracker for Android. It helps track accounts, assets, liabilities, net worth history, product details, and exports without sending personal financial records to a backend service.

The Android package name is `com.fortuna.wealthtracker`.

## Status

This project is usable as an early release, but it should be treated as a personal finance tracker rather than investment, tax, legal, or lending advice. Data is stored locally in the browser or Capacitor app storage via IndexedDB.

## Features

- Account and asset/liability tracking
- Net worth and allocation charts
- Product detail records for deposits, funds, stocks, insurance, debt, cashflow, and other personal finance categories
- Currency settings and exchange-rate refresh support
- Chinese and English UI through i18next
- Local data export and backup flows
- Android build through Capacitor

## Tech Stack

- React 19, TypeScript 6, Vite 8
- Capacitor 8 for Android packaging
- Dexie 4 for IndexedDB persistence
- Recharts 3 for charts
- i18next and react-i18next for localization
- SheetJS for spreadsheet import/export support

## Development

Install dependencies:

```bash
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

Check code quality and build the web app:

```bash
npm run lint
npm run build
```

Sync the web build into Android:

```bash
npx cap sync android
```

Build an Android App Bundle after configuring a release upload key:

```bash
bash scripts/build-release-aab.sh
```

Play Store preparation notes and generated store listing assets live in `release/play-store/` and `docs/play-store-release.md`.

## Privacy Model

Fortuna is designed to be local-first:

- Account records and product data are stored locally.
- No login service is required.
- No analytics SDK or advertising SDK is included.
- Exchange-rate refresh may call a public exchange-rate API.
- Calendar permissions are only relevant if reminder features are enabled by the user.

Always review the generated privacy policy before distributing the app publicly.

## Android Download Notes

Install from GitHub:

1. Open the latest release: https://github.com/charlotteamian/Fortuna/releases/latest
2. Download the `Fortuna-*-debug.apk` file on an Android device.
3. Open the APK. Android may ask you to allow installing unknown apps from the browser or file manager.
4. Confirm the installation.

The GitHub APK is a debug-signed sideload build for personal, non-commercial use. Android may show extra warnings because it is not installed through Google Play.

Build your own APK from a fork:

1. Fork this repository.
2. Open `Actions` in your fork.
3. Run `Android APK Release` manually, or push a tag like `v1.0.1`.
4. Download the generated APK from the workflow artifact or GitHub Release.

For GitHub distribution, publish installable APK files as GitHub Release assets rather than committing generated APK/AAB files to the repository. For Google Play distribution, upload a properly signed AAB through Play Console.

## License

Fortuna is available for personal, private, non-commercial use only. Commercial use, redistribution of modified versions, and commercial distribution of compiled builds require prior written permission from the copyright holder.

See `LICENSE`.
