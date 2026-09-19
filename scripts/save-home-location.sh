#!/usr/bin/env bash
# Stores the real home location in the SOPS vault so the api has it at
# deploy time WITHOUT living in the open-source repo. env.ts ships a
# deliberately public LA placeholder; this provides the real values.
# Run once before the next deploy; safe to re-run to update.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Defaults are the PUBLIC placeholder (LA City Hall) that env.ts also ships,
# so this script carries no real address in the repo.
DEF_LAT="34.0537"
DEF_LON="-118.2428"

echo "Saving your real home location to the vault."
echo "Type your real values. The [brackets] show a PUBLIC placeholder, not your"
echo "home , press Enter only if you actually want the placeholder."
echo ""

read -rp "Latitude  [$DEF_LAT]: " LAT;    LAT="${LAT:-$DEF_LAT}"
read -rp "Longitude [$DEF_LON]: " LON;     LON="${LON:-$DEF_LON}"

for v in "$LAT" "$LON"; do
  [ -n "$v" ] || { echo "FATAL: empty field" >&2; exit 1; }
done

echo "$LAT"    | "$REPO_ROOT/scripts/set-secret.sh" HOME_LOCATION__LAT
echo "$LON"    | "$REPO_ROOT/scripts/set-secret.sh" HOME_LOCATION__LON

echo "Done. Vault keys: HOME_LOCATION__LAT, HOME_LOCATION__LON"
