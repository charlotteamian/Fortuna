# Android release signing

Fortuna GitHub APK releases use one permanent signing identity beginning with `v1.3.0`.

- Certificate SHA-256: `b6898c38efabded0a7a2826ff1b83c5191b3d3be7f0723201984ecd0fc8cf62c`
- Alias: `fortuna-release`
- Pinned fingerprint: `android/release-signing-cert.sha256`
- GitHub Secrets: `FORTUNA_UPLOAD_KEYSTORE_BASE64`, `FORTUNA_UPLOAD_STORE_PASSWORD`, `FORTUNA_UPLOAD_KEY_ALIAS`, `FORTUNA_UPLOAD_KEY_PASSWORD`

The private keystore and passwords must never be committed. Keep an encrypted keystore backup and the password in a separate password manager or system keychain. Losing the private key means future GitHub APKs cannot update existing installations.

The release workflow restores the keystore from GitHub Secrets, builds `assembleRelease`, verifies the APK signature, and compares its certificate with the pinned fingerprint before publishing. A missing or different key fails the release.

For a local build, set all four `FORTUNA_UPLOAD_*` environment variables and run:

```bash
bash scripts/build-release-apk.sh
```

Android requires the same package name and signing certificate for in-place upgrades. Because earlier GitHub APKs used ephemeral debug keys, users must back up, uninstall, install `v1.3.0`, and restore once. Versions after `v1.3.0` can update in place when signed by the pinned key.

Google Play App Signing may use a different app-signing certificate from this GitHub distribution key. Do not assume APKs installed from Google Play and GitHub can update each other without confirming their signing certificates.
