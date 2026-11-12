#!/bin/bash
set -euo pipefail
set +x

product=$1
shift
case "$product" in
  tendr)
    type=appstore
    platform=ios
    bundle_id=com.calumwebb.still
    extension=mobileprovision
    ;;
  callkeep)
    type=developer_id
    platform=macos
    bundle_id=co.calum.callkeep
    extension=provisionprofile
    ;;
  *)
    echo "Unsupported Match product: $product" >&2
    exit 2
    ;;
esac
: "${MATCH_PASSWORD:?Missing Match encryption password}"
: "${MATCH_GIT_BASIC_AUTHORIZATION:?Missing private Match repository access}"

umask 077
signing=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/www-match.XXXXXXXX")
keychain="$signing/signing.keychain-db"
profile_uuid=
security list-keychains -d user > "$signing/search-list"
cleanup() {
  python3 - "$signing/search-list" << 'PY'
import shlex
import subprocess
import sys
from pathlib import Path

keys = shlex.split(Path(sys.argv[1]).read_text())
subprocess.run(["security", "list-keychains", "-d", "user", "-s", *keys], check=True)
PY
  security delete-keychain "$keychain" > /dev/null 2>&1 || true
  if [[ -n "$profile_uuid" && -n "${RUNNER_TEMP:-}" ]]; then
    rm -f "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$profile_uuid.$extension"
  fi
  rm -rf "$signing"
}
trap cleanup EXIT

export MATCH_KEYCHAIN_PASSWORD
MATCH_KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  printf '::add-mask::%s\n' "$MATCH_KEYCHAIN_PASSWORD"
fi
security create-keychain -p "$MATCH_KEYCHAIN_PASSWORD" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$MATCH_KEYCHAIN_PASSWORD" "$keychain"
python3 - "$keychain" "$signing/search-list" << 'PY'
import shlex
import subprocess
import sys
from pathlib import Path

keys = shlex.split(Path(sys.argv[2]).read_text())
subprocess.run(["security", "list-keychains", "-d", "user", "-s", sys.argv[1], *keys], check=True)
PY

bundle exec fastlane match "$type" --readonly true --platform "$platform" \
  --git_url https://github.com/0x63616c/certificates.git --git_branch "$product" \
  --clone_branch_directly true --app_identifier "$bundle_id" --team_id X9E4HG27NK \
  --keychain_name "$keychain" --output_path "$signing"
shopt -s nullglob
profiles=("$signing/"*."$extension")
[[ "${#profiles[@]}" -eq 1 ]] || {
  echo "Expected one Match profile for $product" >&2
  exit 1
}
security cms -D -i "${profiles[0]}" > "$signing/profile.plist"
/usr/libexec/PlistBuddy -c 'Print :UUID' "$signing/profile.plist" > "$signing/profile.uuid"
read -r profile_uuid < "$signing/profile.uuid"
[[ "$profile_uuid" =~ ^[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}$ ]] || exit 1
security find-identity -v -p codesigning "$keychain" | /usr/bin/grep -Eq '^ *1 valid identities found$' || {
  echo "Expected one valid signing identity for $product" >&2
  exit 1
}
rm -f "$signing/"*.cer "$signing/"*.p12
unset MATCH_PASSWORD MATCH_GIT_BASIC_AUTHORIZATION MATCH_KEYCHAIN_PASSWORD

R_PROFILE_UUID="$profile_uuid" MATCH_PROFILE_PATH="${profiles[0]}" MATCH_KEYCHAIN_PATH="$keychain" "$@"
