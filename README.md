# Fortuna

Fortuna is a local-first personal wealth tracker for Android. It helps track accounts, assets, liabilities, net worth history, product details, and exports without sending personal financial records to a backend service.

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

For GitHub distribution, publish installable APK files as GitHub Release assets rather than committing generated APK/AAB files to the repository. For Google Play distribution, upload a properly signed AAB through Play Console.

## License

MIT. See `LICENSE`.
