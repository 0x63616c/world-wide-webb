#!/usr/bin/env bash
# Assemble Pages into an empty directory without Git changes or network access.
# Usage: scripts/build-site.sh <empty-output-directory>
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:?usage: build-site.sh <empty-output-directory>}
mkdir -p "$out"
[[ -z "$(ls -A "$out")" ]] || { echo "Output directory must be empty" >&2; exit 1; }
cp -R site/. "$out/"
if [[ -f site/.legacy-root ]]; then
  legacy=$(tr -d '[:space:]' < site/.legacy-root)
  [[ "$legacy" =~ ^[a-z][a-z0-9-]*$ && -d "site/$legacy" ]] || { echo "Invalid legacy app" >&2; exit 1; }
  cp -R "site/$legacy/." "$out/"
fi
rm -f "$out/README.md" "$out/.legacy-root" "$out/.retain"
touch "$out/.nojekyll"
