#!/bin/sh
# Tesla-map basemap provisioner (www-hn1i).
#
# Extracts the SoCal region from the NEWEST Protomaps daily planet build into
# the maps volume the web nginx serves /maps/*.pmtiles from. The build date is
# resolved AT RUNTIME from the Protomaps build-metadata index: Protomaps deletes
# daily builds after ~7 days, so any hardcoded date rots within a week (that pin
# is exactly what broke prod's Tesla map). The newest listed build can race its
# own upload/deletion, so a failed probe falls back to the previous one.
#
# Modes:
#   provision.sh            if-missing (default): exit 0 instantly when the
#                           target exists, the web initContainer path, so
#                           rollouts on a provisioned PVC are unaffected.
#   provision.sh force      always re-extract, the monthly refresh CronJob.
#
# The write is ATOMIC: extract to a dot-tmp path on the same volume, then
# rename. nginx never serves a partial file, and a refresh swaps under a live
# reader safely.
set -eu

OUT_DIR="${OUT_DIR:-/out}"
OUT_FILE="${OUT_FILE:-socal.pmtiles}"
BBOX="${BBOX:--121.0,32.4,-114.0,35.9}"
MAXZOOM="${MAXZOOM:-15}"
BUILDS_INDEX="${BUILDS_INDEX:-https://build-metadata.protomaps.dev/builds.json}"
BUILDS_BASE="${BUILDS_BASE:-https://build.protomaps.com}"
MODE="${1:-if-missing}"

target="$OUT_DIR/$OUT_FILE"
tmp="$OUT_DIR/.tmp-$OUT_FILE"

if [ "$MODE" = "if-missing" ] && [ -f "$target" ]; then
  echo "map-provision: $target present; nothing to do"
  exit 0
fi

# The two newest build keys (YYYYMMDD.pmtiles sorts lexicographically by date).
keys=$(curl -fsSL "$BUILDS_INDEX" | grep -oE '"key":"[0-9]{8}\.pmtiles"' | grep -oE '[0-9]{8}\.pmtiles' | sort -u | tail -2 | sort -r)
if [ -z "$keys" ]; then
  echo "map-provision: no build keys resolvable from $BUILDS_INDEX" >&2
  exit 1
fi

for key in $keys; do
  url="$BUILDS_BASE/$key"
  if ! curl -fsI -o /dev/null "$url"; then
    echo "map-provision: $url not downloadable, trying previous build" >&2
    continue
  fi
  echo "map-provision: extracting $url (bbox=$BBOX maxzoom=$MAXZOOM mode=$MODE)"
  rm -f "$tmp"
  pmtiles extract "$url" "$tmp" --bbox="$BBOX" --maxzoom="$MAXZOOM"
  mv -f "$tmp" "$target"
  echo "map-provision: wrote $target"
  exit 0
done

echo "map-provision: no resolvable build was downloadable" >&2
exit 1
