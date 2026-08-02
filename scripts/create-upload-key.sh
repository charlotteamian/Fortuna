#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_HOME_DEFAULT="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
KEYTOOL="${JAVA_HOME:-$JAVA_HOME_DEFAULT}/bin/keytool"
OUT="${1:-$ROOT_DIR/fortuna-release.jks}"
ALIAS="${2:-fortuna-release}"

if [[ "${FORTUNA_ALLOW_NEW_SIGNING_KEY:-}" != "yes" ]]; then
  cat <<'EOF'
Fortuna already has a permanent Android signing identity.
Creating another key would make future APKs incompatible with existing installations.

Use the existing protected keystore. Only set FORTUNA_ALLOW_NEW_SIGNING_KEY=yes
when intentionally creating a separate distribution identity.
EOF
  exit 1
fi

if [[ ! -x "$KEYTOOL" ]]; then
  echo "Cannot find keytool. Install Android Studio or set JAVA_HOME."
  exit 1
fi

if [[ -f "$OUT" ]]; then
  echo "Refusing to overwrite existing keystore: $OUT"
  exit 1
fi

"$KEYTOOL" -genkeypair \
  -v \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 36500

cat <<EOF

Created upload keystore:
$OUT

Save this file and its passwords in a password manager.
Never commit the keystore or passwords.

For future builds:

export FORTUNA_UPLOAD_KEYSTORE='$OUT'
export FORTUNA_UPLOAD_STORE_PASSWORD='the password you typed'
export FORTUNA_UPLOAD_KEY_ALIAS='$ALIAS'
export FORTUNA_UPLOAD_KEY_PASSWORD='the key password you typed'
EOF
