#!/usr/bin/env bash
# Stores the real home location in 1Password (Homelab vault, item "Home Location")
# so it is delivered to the api at deploy time (deploy.config.ts fromOp) and to
# local dev (tilt/op-secrets.tpl) WITHOUT living in the open-source repo. env.ts
# ships a deliberately public LA placeholder default; this provides the real
# values. Run once before the next bosun deploy; safe to re-run to update.
#
# Fields are plain text (a home address is private, but not a credential), so
# they resolve cleanly as op:// references in the secret rails.
set -euo pipefail

ITEM="Home Location"
VAULT="Homelab"

# Defaults are the PUBLIC placeholder (LA City Hall) that env.ts also ships, so
# this script carries no real address in the open-source repo. Type your real
# values at the prompts; press Enter only if you genuinely want the placeholder.
DEF_LAT="34.0537"
DEF_LON="-118.2428"
DEF_PLACE="Home"
DEF_RADIUS="1"

echo "Saving your real home location to 1Password ($VAULT/$ITEM)."
echo "Type your real values. The [brackets] show a PUBLIC placeholder, not your"
echo "home , press Enter only if you actually want the placeholder."
echo ""

read -rp "Latitude  [$DEF_LAT]: " LAT;    LAT="${LAT:-$DEF_LAT}"
read -rp "Longitude [$DEF_LON]: " LON;     LON="${LON:-$DEF_LON}"
read -rp "Place name [$DEF_PLACE]: " PLACE; PLACE="${PLACE:-$DEF_PLACE}"
read -rp "Match radius miles [$DEF_RADIUS]: " RADIUS; RADIUS="${RADIUS:-$DEF_RADIUS}"

for v in "$LAT" "$LON" "$PLACE" "$RADIUS"; do
  [ -n "$v" ] || { echo "FATAL: empty field" >&2; exit 1; }
done

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "lat[text]=$LAT" \
    "lon[text]=$LON" \
    "place_name[text]=$PLACE" \
    "radius_miles[text]=$RADIUS" >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "Secure Note" \
    --title "$ITEM" \
    "lat[text]=$LAT" \
    "lon[text]=$LON" \
    "place_name[text]=$PLACE" \
    "radius_miles[text]=$RADIUS" >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the op shim cache for each ref so the next read is fresh.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  for field in lat lon place_name radius_miles; do
    REF="op://$VAULT/$ITEM/$field"
    KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
    rm -f "$EVEE_OP_DIR/$KEY_HASH"
  done
  echo "Cache invalidated."
fi

echo "Verifying..."
for field in lat lon place_name radius_miles; do
  REF="op://$VAULT/$ITEM/$field"
  op read "$REF" >/dev/null && echo "  ok , $REF"
done
echo "Done."
