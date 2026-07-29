#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -z "${FORTUNA_IOS_BUILD_NUMBER:-}" || ! "${FORTUNA_IOS_BUILD_NUMBER}" =~ ^[0-9]+$ || "${FORTUNA_IOS_BUILD_NUMBER}" == "0" ]]; then
  echo "Set FORTUNA_IOS_BUILD_NUMBER to a positive App Store build number." >&2
  exit 1
fi

npm run release:ios

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Fortuna.xcarchive \
  -allowProvisioningUpdates \
  archive

echo "Archive created at $PROJECT_ROOT/build/Fortuna.xcarchive"
