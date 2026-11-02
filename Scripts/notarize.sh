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
# codesign also consults the user keychain search list when resolving trust.
security list-keychains -d user > "$signing_directory/search-list"
restore_keychains() {
  python3 - "$signing_directory/search-list" <<'PYTHON'
import shlex,subprocess,sys
keys=shlex.split(open(sys.argv[1]).read())
subprocess.run(['security','list-keychains','-d','user','-s',*keys],check=True)
PYTHON
}
trap 'restore_keychains; security delete-keychain "$keychain" >/dev/null 2>&1 || true; rm -rf "$signing_directory"' EXIT
printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$signing_directory/certificate.p12"
printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$signing_directory/key.p8"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
echo "Importing signing certificate"
security import "$signing_directory/certificate.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
python3 - "$keychain" "$signing_directory/search-list" <<'PYTHON'
import shlex,subprocess,sys
keys=shlex.split(open(sys.argv[2]).read())
subprocess.run(['security','list-keychains','-d','user','-s',sys.argv[1],*keys],check=True)
PYTHON
echo "Configuring private-key access"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security find-identity -v -p codesigning "$keychain"
echo "Signing framework and app"
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
retry_validation() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    echo "Validation attempt $attempt failed; retrying in 5 seconds" >&2
    sleep 5
  done
  return 1
}
retry_validation xcrun stapler staple "$app"
retry_validation xcrun stapler validate "$app"
retry_validation spctl --assess --type execute --verbose "$app"
rm "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
