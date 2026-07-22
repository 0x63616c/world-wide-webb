#!/bin/bash
# Durable LAN edge for the captive portal's HTTPS: host en1 :443 -> k8s portal LB :443.
#
# WHY THIS EXISTS (www-j934.20): OrbStack `k8s.expose_services` republishes a
# LoadBalancer Service's ports onto the mini's LAN NIC (en1, 192.168.0.147), and it
# does so for the portal's :80 -- but NOT :443. OrbStack's own built-in HTTPS proxy
# (`network.https: true`, serving `*.orb.local` TLS) already holds the wildcard
# host :443, so `expose_services` cannot bind en1 :443 and falls back to a random
# NodePort only. Disabling the orb HTTPS proxy is GUI-only in OrbStack 2.1.1 and
# needs a full restart; this forward is the surgical, restart-free fix and mirrors
# the blessed `com.calum.k8s-apiserver-forward` primitive. :443 is privileged, so
# this runs as a root LaunchDaemon on the mini (the old install docs lived in the
# deleted products/captive-portal tree; after editing this script, reinstall the
# daemon on the mini for the change to take effect).
#
# The portal Service terminates TLS itself with the cert-manager-issued
# captive-portal.worldwidewebb.co cert, so this is a raw TCP passthrough: the LAN
# client validates the real cert end-to-end.
export PATH=/opt/homebrew/bin:/usr/bin:/bin:$PATH
export KUBECONFIG="${KUBECONFIG:-/Users/calum/.kube/config}"

# Resolve the guest listener's LoadBalancer external IP. Since the captive-portal
# product merge (ADR-0006, 2026-07-21) the guest surface is served by the
# control-center `api` Service's portal-only listener — the old `captive-portal`
# Service no longer exists. Hard-fail on resolution errors: a silent fallback here
# once pointed guest HTTPS at a stale IP with no error (Track 0 final review).
PORTAL_IP="$(kubectl --context cc-homelab -n control-center get svc api \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
if [ -z "$PORTAL_IP" ]; then
  echo "portal-443-forward: FATAL: could not resolve control-center/api LoadBalancer IP" >&2
  exit 1
fi

exec socat TCP-LISTEN:443,bind=192.168.0.147,fork,reuseaddr "TCP:${PORTAL_IP}:443"
