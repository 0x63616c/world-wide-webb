#!/bin/bash
set -euo pipefail
set +x
app=$1
archive=$2
for required in MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_API_KEY_P8_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER_ID; do
  if [[ -z ${!required:-} ]]; then echo "Missing signing secret: $required" >&2; exit 1; fi
done
umask 077
signing_directory=$(mktemp -d -t callkeep-signing)
trap 'security delete-keychain "$signing_directory/signing.keychain-db" >/dev/null 2>&1 || true; rm -rf "$signing_directory"' EXIT
keychain="$signing_directory/signing.keychain-db"
keychain_password=$(openssl rand -hex 24)
printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$signing_directory/certificate.p12"
printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$signing_directory/key.p8"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_directory/certificate.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
identity='Developer ID Application: Calum Webb (X9E4HG27NK)'
codesign --force --sign "$identity" --keychain "$keychain" --timestamp --options runtime "$app/Contents/Frameworks/CallkeepCore.framework"
codesign --force --sign "$identity" --keychain "$keychain" --timestamp --options runtime --entitlements Resources/Callkeep.entitlements "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
xcrun notarytool submit "$archive" --key "$signing_directory/key.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" --wait --timeout 10m --output-format json > "$signing_directory/result.json"
python3 - "$signing_directory/result.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1]))
print('Notarization:', result.get('status'), 'Submission:', result.get('id'))
if result.get('status') != 'Accepted': raise SystemExit('Apple did not accept this build; release stopped.')
PY
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose "$app"
rm "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
