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
Missing long-term signing environment variables.

Set FORTUNA_UPLOAD_KEYSTORE, FORTUNA_UPLOAD_STORE_PASSWORD,
FORTUNA_UPLOAD_KEY_ALIAS, and FORTUNA_UPLOAD_KEY_PASSWORD before running this script.
EOF
  exit 1
fi

cd "$ROOT_DIR"
npm test
npm run release:android

cd "$ANDROID_DIR"
./gradlew assembleRelease --console=plain

echo
echo "Signed APK:"
find "$ANDROID_DIR/app/build/outputs/apk/release" -maxdepth 1 -type f -name 'Fortuna-*.apk' -print
