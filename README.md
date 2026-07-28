# Fortuna

**A local-first personal wealth tracker for Android.** Bring bank balances, brokerage holdings, funds, property, debt, and allocation goals into one private overview—without creating an account or sending your financial ledger to a Fortuna server.

[![Latest release](https://img.shields.io/github/v/release/charlotteamian/Fortuna?display_name=tag)](https://github.com/charlotteamian/Fortuna/releases/latest)
[![Android build](https://github.com/charlotteamian/Fortuna/actions/workflows/android-apk-release.yml/badge.svg)](https://github.com/charlotteamian/Fortuna/actions/workflows/android-apk-release.yml)
[![License](https://img.shields.io/badge/license-personal%20use-blue)](LICENSE)

> Fortuna is a record-keeping tool, not investment, tax, legal, or lending advice. Android package: `com.fortuna.wealthtracker`.

## What it does

| Area | Core capabilities |
| --- | --- |
| **Accounts & net worth** | Track assets and liabilities across institutions, categories, and currencies; archive old accounts without losing history. |
| **Holdings & products** | Maintain securities by quantity and price, balance-based funds/deposits, cash inside portfolio accounts, transaction history, realized/unrealized P&L, and sold-out archived positions. |
| **Allocation planning** | Build top-level targets and subcategories, link exact accounts/holdings/cash pools, share one resource across plans, and compare current vs target structure. |
| **History & charts** | Keep balance/value snapshots and explore net worth, asset mix, liabilities, currencies, and historical change. |
| **Backup & portability** | Export/import a complete Excel backup, export readable reports, and optionally write a portable JSON snapshot to a folder selected by the user. |
| **Everyday usability** | First-install walkthrough, full in-app guide, Chinese/English UI, light/dark themes, adjustable text size, amount masking, and optional calendar reminders. |

## What you can do

- **See the whole balance sheet:** combine cash, deposits, investments, property, cards, and loans in one net-worth view.
- **Model how money is actually held:** use one broker or bank as an account, then manage its cash, holdings, deposits, or products underneath.
- **Keep closed positions without clutter:** sold-out holdings and zero-balance products stay available in a collapsed archive and return automatically if funded again.
- **Plan with real resources:** assign an exact holding or cash pool to one or several goals while Fortuna prevents double counting.
- **Move your data yourself:** create a human-readable Excel backup and restore it without a cloud account.

## Screenshots

All screenshots below use the fully synthetic dataset in [`demo/`](demo/README.md).

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/overview.png" width="240" alt="Fortuna account and net worth overview"><br><sub>Net worth overview</sub></td>
    <td align="center"><img src="docs/screenshots/portfolio-account.png" width="240" alt="Fortuna portfolio account with holdings"><br><sub>Holdings and account cash</sub></td>
    <td align="center"><img src="docs/screenshots/allocation-plan.png" width="240" alt="Fortuna allocation planning"><br><sub>Allocation plan</sub></td>
    <td align="center"><img src="docs/screenshots/charts.png" width="240" alt="Fortuna net worth charts"><br><sub>History and charts</sub></td>
  </tr>
</table>

## Try the demo

The repository includes a deterministic fictional portfolio—no personal records, real account identifiers, or real transactions.

1. Download [`Fortuna-Demo-Portfolio.xlsx`](demo/Fortuna-Demo-Portfolio.xlsx).
2. In Fortuna, open **Settings → Data Backup → Import Backup**.
3. Select the workbook. Import replaces the current local database, so export your own backup first.

The reviewable JSON source and regeneration instructions are in [`demo/`](demo/README.md).

## Install on Android

1. Open the [latest GitHub Release](https://github.com/charlotteamian/Fortuna/releases/latest).
2. Download `Fortuna-*-debug.apk` on the Android device.
3. Open it and allow installation from that browser or file manager if Android asks.

The GitHub asset is a debug-signed sideload build for personal, non-commercial use. Android may show additional warnings because it does not come from Google Play.

## Privacy by design

- Financial records are stored locally in IndexedDB inside the browser/Capacitor app container.
- No Fortuna login, developer-operated financial backend, analytics SDK, or advertising SDK is included.
- Exchange-rate, precious-metal, and supported quote refreshes contact independent public data services only when that feature needs a lookup.
- Calendar access is used only when the user creates a reminder.
- Android backup, user-selected exports, and optional snapshot folders can move data outside the app according to the user's explicit choices and system settings.

See the bundled [privacy policy](release/play-store/privacy-policy.md) for the current endpoint and permission boundary.

## Build from source

Requirements: Node.js 24+, Java 21, and the Android SDK.

```bash
npm ci
npm run lint
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Useful project commands:

```bash
npm run dev            # Vite development server
npm run demo:generate  # rebuild the synthetic JSON and Excel demo
npm run release:web    # lint, build, and sync Android web assets
```

For a signed Play Store bundle, configure an upload key and run `bash scripts/build-release-aab.sh`. Publishing notes live in [`docs/play-store-release.md`](docs/play-store-release.md).

## Architecture

- React 19 + TypeScript 6 + Vite 8
- Capacitor 8 Android shell
- Dexie 4 / IndexedDB local persistence
- Recharts 3 visualizations
- i18next Chinese/English localization
- SheetJS Excel import/export

## Repository layout

```text
src/                    React application, database, services, and domain logic
android/                Capacitor Android project
scripts/                tests, release helpers, and demo generator
demo/                   synthetic JSON source and importable Excel backup
docs/screenshots/       public screenshots generated from the demo data
release/play-store/     store listing, privacy, and publishing materials
.github/workflows/      reproducible Android APK release workflow
```

## Release notes

See [`CHANGELOG.md`](CHANGELOG.md) and [GitHub Releases](https://github.com/charlotteamian/Fortuna/releases).

## License

Fortuna is source-available for personal, private, non-commercial use. Commercial use, commercial distribution, and redistribution of modified versions require prior written permission from the copyright holder. See [`LICENSE`](LICENSE).
