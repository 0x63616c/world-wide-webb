#!/usr/bin/env bash
# LAN-edge proxy for the captive portal (www-q002.21, HTTPS on :42069 in www-q002.22).
#
# WHY THIS EXISTS: OrbStack does NOT forward Docker Swarm published ports to the
# Mac host / LAN (proven: neither ingress nor host mode binds on the Mac; lsof on
# :443 is empty). Only a PLAIN `docker run -p` is forwarded to the LAN. So the
# captive-portal swarm service serves :443/:80 on the overlay, and THIS thin nginx
# proxy, a plain non-swarm container joined to the attachable
# `control-center_portal-edge` overlay, publishes to the LAN and fronts the swarm
# service.
#
# HTTPS ON THE LAN (www-q002.22): host :443 is ALSO trapped, OrbStack binds it for
# its own *.orb.local HTTPS proxy (config network.https=true), so a plain
# `-p 443:443` records a mapping but never actually LISTENs on the Mac (docker port
# shows it, lsof is empty). :8443 is OrbStack HTTPS territory too (per its docs).
# So we terminate the portal TLS on a NEUTRAL host port :42069 that OrbStack does
# not reserve, and the LAN edge 301-redirects plain http :80 ->
# https://captive-portal.worldwidewebb.co:42069 so a guest hitting :80 lands on
# TLS. Guest secrets (email + WiFi password) are entered on the SPA AFTER the
# redirect, so they only ever travel over TLS; the http hop carries only the
# UniFi redirect params (mac/ap/site), never a secret. The redirect lives HERE at
# the LAN edge (not the swarm portal's :80) so the swarm healthcheck + the deploy
# probe on :80 keep getting a 200, and the :42069 topology stays out of the service image.
#
# NOTE (www-j934): this whole Swarm-era LAN-edge hack is superseded under k3s by a
# captive-portal `Service type: LoadBalancer` republished on the LAN NIC via OrbStack
# `expose_services` (see docs/captive-portal/runbook.md). This script is retired at cutover.
#
# Idempotent: re-run to refresh (e.g. after a portal redeploy). Pinned by
# --restart=always; the launchd unit re-runs it at boot so it survives reboots.

NET=control-center_portal-edge          # stack-namespaced attachable overlay
NAME=portal-lan
TLS_HOST_PORT=42069                      # neutral host port (NOT :443/:8443, OrbStack-reserved)

# Pure renderer (no side effects) so scripts/test-portal-lan.sh can assert the
# topology without docker. L4 stream passthrough for TLS (terminates at the swarm
# portal, not here) on :443; an http :80 server that only 301-redirects to the
# neutral TLS port. The stream upstream is resolved per-connection via docker DNS
# so a portal reschedule (new task IP) is picked up without restarting this proxy.
portal_lan_render_conf() {
  cat <<'NGINX'
events {}
stream {
  resolver 127.0.0.11 valid=10s ipv6=off;
  server {
    listen 443;
    set $portal_tls captive-portal:443;
    proxy_pass $portal_tls;
  }
}
http {
  server {
    listen 80;
    server_name _;
    # Bounce every plain-http guest hit to TLS on the neutral host port. The
    # UniFi external-portal redirect lands here on :80; $request_uri preserves
    # the mac/ap/site query params through to the SPA over HTTPS.
    return 301 https://captive-portal.worldwidewebb.co:42069$request_uri;
  }
}
NGINX
}

# --- main (guarded so sourcing for tests has no side effects) ----------------
portal_lan_main() {
  set -euo pipefail
  local conf_dir="${PORTAL_LAN_DIR:-$HOME/control-center/portal-lan}"
  mkdir -p "$conf_dir"
  portal_lan_render_conf > "$conf_dir/nginx.conf"

  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart=always \
    --network "$NET" \
    -p "$TLS_HOST_PORT:443" -p 80:80 \
    -v "$conf_dir/nginx.conf:/etc/nginx/nginx.conf:ro" \
    nginx:1.27-alpine

  echo "portal-lan: LAN :$TLS_HOST_PORT (TLS) + :80 (->https) -> captive-portal over $NET (plain -p, OrbStack-forwarded)"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  portal_lan_main "$@"
fi
