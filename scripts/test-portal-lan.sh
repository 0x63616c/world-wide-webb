#!/usr/bin/env bash
#
# Hermetic tests for the captive-portal LAN-edge proxy config (www-q002.22).
# No real docker: we source portal-lan.sh (its main body is BASH_SOURCE-guarded so
# sourcing has no side effects) and exercise the pure conf renderer directly.
# Mirrors scripts/test-orbstack-watchdog.sh.
#
# WHY THIS EXISTS: OrbStack binds host :443 for its own *.orb.local HTTPS proxy
# (config network.https=true), so a plain `docker run -p 443:443` never surfaces
# on the Mac (proven www-q002.21/.22). The fix (www-q002.22) terminates the portal
# TLS on a neutral host port :42069 that OrbStack does NOT reserve, and the LAN
# edge 301-redirects plain http :80 -> https://...:42069 so a guest who hits :80
# lands on TLS. These tests pin that topology.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=/dev/null
source "$HERE/portal-lan.sh"

PASS=0
FAIL=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $1 - expected '$2', got '$3'"
  fi
}
has() { # has <desc> <needle> <haystack>
  case "$3" in
    *"$2"*) check "$1" yes yes ;;
    *)      check "$1" yes no ;;
  esac
}
hasnt() { # hasnt <desc> <needle> <haystack>
  case "$3" in
    *"$2"*) check "$1" absent present ;;
    *)      check "$1" absent absent ;;
  esac
}

CONF="$(portal_lan_render_conf)"

# --- stream :443 (TLS passthrough to the swarm portal) -----------------------
has "stream block present"            "stream {"                  "$CONF"
has "stream listens :443"             "listen 443;"               "$CONF"
has "stream passes to portal :443"    "captive-portal:443"        "$CONF"
has "embedded DNS resolver (reschedule-safe)" "resolver 127.0.0.11" "$CONF"

# --- http :80 -> 301 https on :42069 (the LAN-edge redirect) -----------------
has "http block present"              "http {"                    "$CONF"
has "http listens :80"                "listen 80;"                "$CONF"
has "301 to https on the neutral TLS port" \
  "return 301 https://captive-portal.worldwidewebb.co:42069\$request_uri;" "$CONF"

# The redirect MUST NOT use :443/:8443 (both are OrbStack HTTPS territory).
hasnt "redirect never targets :443"   "co:443"                    "$CONF"
hasnt "redirect never targets :8443"  ":8443"                     "$CONF"

# --- the published host port mapping (grep the script source, comments stripped
# so explanatory prose about the OLD broken `-p 443:443` can't fool the asserts) -
SRC="$(grep -vE '^[[:space:]]*#' "$HERE/portal-lan.sh")"
has "neutral TLS host port is :42069"          "TLS_HOST_PORT=42069" "$SRC"
has "publishes the TLS port -> container :443"  '$TLS_HOST_PORT:443'  "$SRC"
has "keeps host :80 -> container :80"           "-p 80:80"           "$SRC"
hasnt "never publishes host :443"               "443:443"            "$SRC"
hasnt "never publishes host :8443"              "8443:"              "$SRC"

echo "----"
echo "portal-lan: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
