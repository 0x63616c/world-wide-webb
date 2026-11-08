#!/usr/bin/env bash
# Scaffolds a new -r app from templates/new-app.
#   scripts/new-app.sh <Name> <bundle-suffix>
#   scripts/new-app.sh Samplr samplr      → apps/samplr, bundle ID com.calumwebb.samplr, site/samplr
#
# Creates the XcodeGen project (RDesign, launch screen, placeholder icon, Home and Settings with
# privacy and support links, a screenshot UI test), apps/<app>/app.yml for fastlane and CI,
# a metadata skeleton, screenshot frames and site pages. CI picks the app up automatically.
# What still needs a person is printed at the end (and listed in docs/NEW-APP.md).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
raw=${1:-}
suffix=${2:-}
[[ -n "$raw" && -n "$suffix" ]] || fail "usage: scripts/new-app.sh <Name> <bundle-suffix>"
[[ "$raw" =~ ^[A-Za-z][A-Za-z0-9]*$ ]] || fail "Name must be letters and digits, starting with a letter (for example Samplr)"
[[ "$suffix" =~ ^[a-z0-9][a-z0-9.-]*$ ]] || fail "Bundle suffix must be lowercase letters, digits, dots or hyphens"

name="$(printf '%s' "${raw:0:1}" | tr '[:lower:]' '[:upper:]')${raw:1}"
slug=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')
bundle="com.calumwebb.$suffix"
dest="apps/$slug"
[[ ! -e "$dest" ]] || fail "$dest already exists"
[[ ! -e "site/$slug" ]] || fail "site/$slug already exists"
repo=$(basename -s .git "$(git remote get-url origin 2>/dev/null || echo apps)")
pages="https://0x63616c.github.io/$repo/$slug/"

cp -R templates/new-app/app "$dest"
cp -R templates/new-app/site "site/$slug"
find "$dest" "site/$slug" -type f \( -name '*.swift' -o -name '*.yml' -o -name '*.json' -o -name '*.txt' -o -name '*.md' -o -name '*.html' -o -name '*.plist' \) -print0 |
  while IFS= read -r -d '' file; do
    sed -i.bak \
      -e "s#__NAME__#$name#g" -e "s#__SLUG__#$slug#g" -e "s#__BUNDLE_ID__#$bundle#g" \
      -e "s#__PAGES__#$pages#g" -e "s#__YEAR__#$(date +%Y)#g" -e "s#__DATE__#$(date '+%B %-d, %Y')#g" \
      "$file"
    rm -f "$file.bak"
  done

marker='<!-- apps: scripts/new-app.sh adds a card per app above this line -->'
card="<a class=\"card\" href=\"./$slug/\"><h2>$name</h2><span>New app</span></a>"
sed -i.bak "s#$marker#$card\\
$marker#" site/index.html && rm -f site/index.html.bak

if command -v xcodegen >/dev/null; then
  (cd "$dest" && xcodegen generate --quiet)
  generated="Generated $dest/$name.xcodeproj."
else
  generated="Install XcodeGen (brew install xcodegen), then run: (cd $dest && xcodegen generate)"
fi

cat <<EOF
Created $name ($bundle) in $dest and site/$slug. $generated

Done for you: RDesign, launch screen, placeholder icon, Settings with privacy and support links,
screenshot UI test, app.yml (fastlane + CI), metadata skeleton, screenshots.json and site pages.

Still needs a person:
  1. App Store Connect: New App ($name, bundle ID $bundle). This needs a web sign-in.
     The bundle ID is registered there too (or under Certificates, Identifiers & Profiles).
  2. Put the new app's numeric Apple ID in $dest/app.yml (apple_id) and set testflight: true.
  3. Create the "Owner Preview" internal TestFlight group for the app (or change testflight_group).
  4. Replace the placeholder icon and launch glyph in $dest/App/Assets.xcassets.
  5. Write the listing in $dest/fastlane/metadata, the screenshot headlines in
     $dest/screenshots.json, and review site/$slug/privacy before publishing (scripts/publish-site.sh).
  6. Commit and push: CI builds the app; TestFlight uploads start once testflight is true.
EOF
