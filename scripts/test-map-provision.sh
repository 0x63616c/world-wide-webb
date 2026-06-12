#!/usr/bin/env bash
#
# Hermetic tests for the basemap provisioner (CC-hn1i). No network, no real
# pmtiles: `curl` and `pmtiles` are PATH stubs, the builds index is a fixture.
# Pins the load-bearing behaviors: runtime build resolution (no date pin to
# rot), if-missing fast-path, force refresh, newest→previous fallback, atomic
# rename, and the nginx /maps/ loud-404 (no SPA fallback for a missing basemap).
# Mirrors scripts/test-orbstack-watchdog.sh / test-check-*.sh.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SCRIPT="$REPO/apps/map-provision/provision.sh"

PASS=0
FAIL=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $1, expected '$2', got '$3'"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STUB="$TMP/bin"
OUT="$TMP/out"
mkdir -p "$STUB" "$OUT"
export PATH="$STUB:$PATH"

# Fixture index: an old build, then the two newest (lexicographic order is
# date order for YYYYMMDD keys). The script must pick 20260610 first.
cat >"$TMP/builds.json" <<'EOF'
[{"key":"20230918.pmtiles","size":1},{"key":"20260601.pmtiles","size":2},{"key":"20260610.pmtiles","size":3}]
EOF

# curl stub: `-fsSL <index-url>` cats the fixture; `-fsI -o /dev/null <url>`
# HEAD-probes, fails when the basename is listed in CURL_HEAD_404 (space-
# separated), so tests can take the newest build offline.
cat >"$STUB/curl" <<EOF
#!/usr/bin/env bash
url="\${!#}"
case "\$*" in
  *builds.json*) cat "$TMP/builds.json" ;;
  *-I*|*-fsI*)
    for miss in \${CURL_HEAD_404:-}; do
      [ "\$(basename "\$url")" = "\$miss" ] && exit 22
    done
    exit 0 ;;
  *) exit 22 ;;
esac
EOF
chmod +x "$STUB/curl"

# pmtiles stub: `extract <url> <dest> ...` writes a marker naming its source,
# and logs the invocation so tests can assert it ran (or didn't).
cat >"$STUB/pmtiles" <<EOF
#!/usr/bin/env bash
echo "pmtiles \$*" >> "$TMP/pmtiles.log"
[ "\$1" = "extract" ] || exit 1
echo "EXTRACTED-FROM \$2" > "\$3"
EOF
chmod +x "$STUB/pmtiles"

run() { OUT_DIR="$OUT" sh "$SCRIPT" "$@" >/dev/null 2>&1; echo $?; }
extract_count() { grep -c extract "$TMP/pmtiles.log" 2>/dev/null || echo 0; }

# --- if-missing: empty volume → extract the NEWEST build, atomically ---------
rm -f "$OUT"/* "$OUT"/.tmp-* "$TMP/pmtiles.log"
check "if-missing on empty volume exits 0" 0 "$(run)"
check "extracted the newest build" "EXTRACTED-FROM https://build.protomaps.com/20260610.pmtiles" "$(cat "$OUT/socal.pmtiles")"
check "no tmp file left behind (atomic rename)" "" "$(ls "$OUT" | grep '^\.tmp' || true)"

# --- if-missing: file present → instant no-op (the initContainer fast path) --
rm -f "$TMP/pmtiles.log"
check "if-missing with file present exits 0" 0 "$(run)"
check "and does NOT re-extract" 0 "$(extract_count)"

# --- force: file present → re-extracts anyway (the refresh CronJob path) -----
rm -f "$TMP/pmtiles.log"
check "force with file present exits 0" 0 "$(run force)"
check "and re-extracts" 1 "$(extract_count)"

# --- fallback: newest build offline → previous one used ----------------------
rm -f "$OUT/socal.pmtiles" "$TMP/pmtiles.log"
export CURL_HEAD_404="20260610.pmtiles"
check "newest offline still exits 0" 0 "$(run)"
check "fell back to the previous build" "EXTRACTED-FROM https://build.protomaps.com/20260601.pmtiles" "$(cat "$OUT/socal.pmtiles")"
unset CURL_HEAD_404

# --- both candidates offline → loud failure ----------------------------------
rm -f "$OUT/socal.pmtiles" "$TMP/pmtiles.log"
export CURL_HEAD_404="20260610.pmtiles 20260601.pmtiles"
check "no downloadable build exits non-zero" 1 "$(run)"
check "and never extracts" 0 "$(extract_count)"
unset CURL_HEAD_404

# --- no date pin anywhere (the rot that broke prod, CC-hn1i) -----------------
pins="$(grep -rE 'build\.protomaps\.com/[0-9]{8}' "$REPO/infra/src" "$REPO/apps/map-provision" 2>/dev/null || true)"
check "no hardcoded Protomaps build date in infra/ or the provisioner" "" "$pins"

# --- nginx: /maps/ is a loud 404, never the SPA index.html fallback ----------
nginx_conf="$REPO/apps/web/nginx.conf"
maps_block="$(awk '/location \/maps\//,/}/' "$nginx_conf")"
check "nginx has an exact /maps/ location" "yes" "$([ -n "$maps_block" ] && echo yes)"
check "/maps/ misses return 404, not index.html" "yes" "$(echo "$maps_block" | grep -q 'try_files \$uri =404' && echo yes)"

echo "map-provision tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
