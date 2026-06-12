#!/bin/bash
# Durable LAN edge for the captive portal's HTTPS: host en1 :443 -> k8s portal LB :443.
#
# WHY THIS EXISTS (CC-j934.20): OrbStack `k8s.expose_services` republishes a
# LoadBalancer Service's ports onto the mini's LAN NIC (en1, 192.168.0.147), and it
# does so for the portal's :80 -- but NOT :443. OrbStack's own built-in HTTPS proxy
# (`network.https: true`, serving `*.orb.local` TLS) already holds the wildcard
# host :443, so `expose_services` cannot bind en1 :443 and falls back to a random
# NodePort only. Disabling the orb HTTPS proxy is GUI-only in OrbStack 2.1.1 and
# needs a full restart; this forward is the surgical, restart-free fix and mirrors
# the blessed `com.calum.k8s-apiserver-forward` primitive. :443 is privileged, so
# this runs as a root LaunchDaemon (see apps/captive-portal/deploy/).
#
# The portal Service terminates TLS itself with the cert-manager-issued
# captive-portal.worldwidewebb.co cert, so this is a raw TCP passthrough: the LAN
# client validates the real cert end-to-end.
export PATH=/opt/homebrew/bin:/usr/bin:/bin:$PATH
export KUBECONFIG="${KUBECONFIG:-/Users/calum/.kube/config}"

# Resolve the portal LoadBalancer's external IP; fall back to the known-stable
# OrbStack k8s LB/node IP (192.168.139.2, same constant the apiserver-forward uses).
PORTAL_IP="$(kubectl --context orbstack -n control-center get svc captive-portal \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)"
[ -z "$PORTAL_IP" ] && PORTAL_IP="192.168.139.2"

exec socat TCP-LISTEN:443,bind=192.168.0.147,fork,reuseaddr "TCP:${PORTAL_IP}:443"
