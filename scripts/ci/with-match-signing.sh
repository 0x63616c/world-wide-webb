#!/bin/bash
set -euo pipefail
set +x

product=$1
shift
branch=$product
extra_certs=()
case "$product" in
  tendr)
    type=appstore
    platform=ios
    bundle_id=com.calumwebb.still
    extension=mobileprovision
    ;;
  tapes)
    type=appstore
    platform=ios
    bundle_id=co.worldwidewebb.tapes
    extension=mobileprovision
    ;;
  tapes-tvos)
    # The app and its Top Shelf extension each have a profile.
    branch=tapes
    type=appstore
    platform=tvos
    bundle_id=co.worldwidewebb.tapes,co.worldwidewebb.tapes.TopShelf
    extension=mobileprovision
    ;;
  tapes-macos)
    # Mac App Store uploads are installer packages, signed with a second certificate.
    branch=tapes
    type=appstore
    platform=macos
    bundle_id=co.worldwidewebb.tapes
    extension=provisionprofile
    extra_certs=(--additional_cert_types mac_installer_distribution)
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

original_umask=$(umask)
umask 077
signing=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/www-match.XXXXXXXX")
keychain="$signing/signing.keychain-db"
profile_uuid=
profile_uuids=()
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
  if [[ -n "${RUNNER_TEMP:-}" ]]; then
    for uuid in ${profile_uuids[@]+"${profile_uuids[@]}"}; do
      rm -f "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$uuid.$extension"
    done
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
  --git_url https://github.com/0x63616c/certificates.git --git_branch "$branch" \
  --clone_branch_directly true --app_identifier "$bundle_id" --team_id X9E4HG27NK \
  --keychain_name "$keychain" --output_path "$signing" ${extra_certs[@]+"${extra_certs[@]}"}
shopt -s nullglob
IFS=, read -r -a bundle_ids <<< "$bundle_id"
profiles=("$signing/"*."$extension")
[[ "${#profiles[@]}" -eq "${#bundle_ids[@]}" ]] || {
  echo "Expected ${#bundle_ids[@]} Match profiles for $product" >&2
  exit 1
}
# R_PROFILE_UUIDS maps each bundle ID to its profile ("id=uuid,id=uuid"); R_PROFILE_UUID and
# MATCH_PROFILE_PATH are the app's own.
profile_map=
main_profile=
for profile in "${profiles[@]}"; do
  security cms -D -i "$profile" > "$signing/profile.plist"
  uuid=$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$signing/profile.plist")
  [[ "$uuid" =~ ^[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}$ ]] || exit 1
  app_id=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$signing/profile.plist" 2> /dev/null \
    || /usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$signing/profile.plist")
  profile_uuids+=("$uuid")
  profile_map+="${profile_map:+,}${app_id#*.}=$uuid"
  if [[ "${app_id#*.}" == "${bundle_ids[0]}" ]]; then
    profile_uuid=$uuid
    main_profile=$profile
  fi
done
[[ -n "$profile_uuid" ]] || {
  echo "No Match profile for ${bundle_ids[0]}" >&2
  exit 1
}
security find-identity -v -p codesigning "$keychain" | /usr/bin/grep -Eq '^ *1 valid identities found$' || {
  echo "Expected one valid signing identity for $product" >&2
  exit 1
}
rm -f "$signing/"*.cer "$signing/"*.p12
unset MATCH_PASSWORD MATCH_GIT_BASIC_AUTHORIZATION MATCH_KEYCHAIN_PASSWORD

# The build runs with the caller's umask: under 077 a Mac installer package holds files only root
# can read, which App Store Connect rejects (error 90255).
umask "$original_umask"
R_PROFILE_UUID="$profile_uuid" R_PROFILE_UUIDS="$profile_map" MATCH_PROFILE_PATH="$main_profile" MATCH_KEYCHAIN_PATH="$keychain" "$@"
