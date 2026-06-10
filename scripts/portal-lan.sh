#!/usr/bin/env bash
# LAN-edge proxy for the captive portal (CC-q002.21).
#
# WHY THIS EXISTS: OrbStack does NOT forward Docker Swarm published ports to the
# Mac host / LAN (proven: neither ingress nor host mode binds on the Mac; lsof on
# :443 is empty). Only a PLAIN `docker run -p` is forwarded to the LAN. So the
# captive-portal swarm service serves :443/:80 on the overlay, and THIS thin L4
# (stream) nginx proxy, a plain non-swarm container joined to the attachable
# `control-center_portal-edge` overlay, publishes :443/:80 to the LAN and passes
# raw TCP through to the swarm service (TLS terminates at the portal, not here).
#
# Idempotent: re-run to refresh (e.g. after a portal redeploy). Pinned by
# --restart=always; the launchd unit re-runs it at boot so it survives reboots.
set -euo pipefail

NET=control-center_portal-edge          # stack-namespaced attachable overlay
NAME=portal-lan
CONF_DIR="${PORTAL_LAN_DIR:-$HOME/control-center/portal-lan}"
mkdir -p "$CONF_DIR"

# L4 passthrough: resolve the swarm service per-connection via docker DNS so a
# portal reschedule (new task IP) is picked up without restarting this proxy.
cat > "$CONF_DIR/nginx.conf" <<'NGINX'
events {}
stream {
  resolver 127.0.0.11 valid=10s ipv6=off;
  server {
    listen 443;
    set $portal_tls captive-portal:443;
    proxy_pass $portal_tls;
  }
  server {
    listen 80;
    set $portal_http captive-portal:80;
    proxy_pass $portal_http;
  }
}
NGINX

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart=always \
  --network "$NET" \
  -p 443:443 -p 80:80 \
  -v "$CONF_DIR/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:1.27-alpine

echo "portal-lan: LAN :443/:80 -> captive-portal over $NET (plain -p, OrbStack-forwarded)"
