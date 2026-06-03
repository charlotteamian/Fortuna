#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
JAVA_HOME_DEFAULT="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

if [[ -z "${JAVA_HOME:-}" && -d "$JAVA_HOME_DEFAULT" ]]; then
  export JAVA_HOME="$JAVA_HOME_DEFAULT"
fi

if [[ -z "${FORTUNA_UPLOAD_KEYSTORE:-}" || -z "${FORTUNA_UPLOAD_STORE_PASSWORD:-}" || -z "${FORTUNA_UPLOAD_KEY_ALIAS:-}" || -z "${FORTUNA_UPLOAD_KEY_PASSWORD:-}" ]]; then
  cat <<'EOF'
Missing signing environment variables.

Set these before building the Play Store AAB:

export FORTUNA_UPLOAD_KEYSTORE=/absolute/path/fortuna-upload-key.jks
export FORTUNA_UPLOAD_STORE_PASSWORD='your-store-password'
export FORTUNA_UPLOAD_KEY_ALIAS=fortuna-upload
export FORTUNA_UPLOAD_KEY_PASSWORD='your-key-password'

Then run:

bash scripts/build-release-aab.sh
EOF
  exit 1
fi

cd "$ROOT_DIR"
npm run release:web

cd "$ANDROID_DIR"
./gradlew bundleRelease

echo
echo "Signed AAB:"
echo "$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
