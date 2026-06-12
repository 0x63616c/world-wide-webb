#!/usr/bin/env bash
# Guard: the captive-portal nginx must stay k8s-correct, no Swarm-era upstream
# config (www-q002.25). Two regressions this blocks, both of which left every
# /api/trpc/portal.* call returning nginx 500 ("no host in upstream :4201"):
#
#   1. `resolver 127.0.0.11` (Docker/Swarm embedded DNS). That IP does not exist
#      in a k8s pod, so a variable upstream can never resolve.
#   2. A `set $var ...;` upstream that sits AFTER a `rewrite ... break;` in the
#      portal location. `break` halts nginx's rewrite phase, so the `set` never
#      runs and the upstream host is empty.
#
# The fix is a literal Service-FQDN proxy_pass. This guard asserts that shape.
# Runs in lefthook pre-commit (staged portal nginx) and CI. Exit non-zero on a
# finding. Pass alternate paths as args for the hermetic self-test.

set -euo pipefail

NGINX_CONF="${1:-apps/captive-portal/nginx.conf}"
LOCATIONS_CONF="${2:-apps/captive-portal/_portal_locations.conf}"

fail=0
err() {
  echo "check-portal-nginx: $1" >&2
  fail=1
}

for f in "$NGINX_CONF" "$LOCATIONS_CONF"; do
  [ -f "$f" ] || { err "missing config: $f"; continue; }
  # 1. No Swarm embedded-DNS resolver.
  if grep -qE '^[[:space:]]*resolver[[:space:]]+127\.0\.0\.11' "$f"; then
    err "$f: Swarm embedded-DNS 'resolver 127.0.0.11' (absent in k8s pods)"
  fi
done

if [ -f "$LOCATIONS_CONF" ]; then
  # 2. The portal proxy_pass must NOT use a variable host (the unset-after-break
  #    footgun); it must target the api Service by a literal name.
  if grep -qE 'proxy_pass[[:space:]]+https?://\$' "$LOCATIONS_CONF"; then
    err "$LOCATIONS_CONF: proxy_pass uses a \$variable upstream; use a literal api Service host so it can't end up unset (www-q002.25)"
  fi
  if ! grep -qE 'proxy_pass[[:space:]]+http://api(\.|:)' "$LOCATIONS_CONF"; then
    err "$LOCATIONS_CONF: portal proxy_pass does not target the api Service (expected http://api...:4201)"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "check-portal-nginx: FAILED" >&2
  exit 1
fi
echo "check-portal-nginx: ok"
