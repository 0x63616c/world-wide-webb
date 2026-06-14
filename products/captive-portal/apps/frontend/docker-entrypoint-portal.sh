#!/bin/sh
# Captive-portal container entrypoint (www-q002.14).
#
# nginx terminates TLS on :443. The REAL Let's Encrypt cert is written by the
# portal-cert-renew acme.sh cron job into the shared portal-certs volume, which
# the portal mounts READ-ONLY at /certs (so a compromised portal can't tamper
# with the key). On a fresh deploy that volume is empty and the real cert has not
# issued yet, so nginx would fail to load a cert and crash-loop the service.
#
# nginx therefore points at a WRITABLE image-internal dir, /etc/nginx/portal-certs
# (NOT the read-only /certs volume directly). This entrypoint populates it:
#   1. If the real cert exists on the /certs volume, copy it into the live dir.
#   2. Otherwise mint a self-signed PLACEHOLDER into the live dir (writable, so
#      this always succeeds even though /certs is read-only). nginx + the :80
#      healthcheck come up green immediately; the placeholder is replaced the
#      moment the real cert lands (step 3).
#   3. A background loop every few minutes: if the real cert has appeared on the
#      volume and differs from what's live, copy it in and `nginx -s reload`. So a
#      cert issued by the cron after boot is adopted with no restart, no docker
#      socket, no privileged signal, the container reloads itself.
#   4. exec nginx as PID 1.
#
# The earlier version wrote the placeholder to /certs directly, which FAILS on the
# read-only mount and crash-looped the container on first deploy (www-q002.14).
set -eu

VOL_DIR=/certs                       # read-only shared volume (real cert lands here)
LIVE_DIR=/etc/nginx/portal-certs     # writable, image-internal; nginx reads from here
LIVE_FULLCHAIN="$LIVE_DIR/fullchain.pem"
LIVE_KEY="$LIVE_DIR/key.pem"

mkdir -p "$LIVE_DIR"

# Copy the real cert from the volume into the live dir if present + non-empty.
sync_real_cert() {
    if [ -s "$VOL_DIR/fullchain.pem" ] && [ -s "$VOL_DIR/key.pem" ]; then
        # Only copy when changed, so the reload loop is a no-op in steady state.
        if ! cmp -s "$VOL_DIR/fullchain.pem" "$LIVE_FULLCHAIN" 2>/dev/null; then
            cp "$VOL_DIR/fullchain.pem" "$LIVE_FULLCHAIN"
            cp "$VOL_DIR/key.pem" "$LIVE_KEY"
            return 0   # changed
        fi
    fi
    return 1           # unchanged / no real cert
}

# Initial population: real cert if available, else a self-signed placeholder.
if ! sync_real_cert; then
    if [ ! -s "$LIVE_FULLCHAIN" ] || [ ! -s "$LIVE_KEY" ]; then
        echo "portal-entrypoint: no real cert on the volume yet, minting a self-signed placeholder"
        # 1-year self-signed so the placeholder never itself expires into a crash
        # before acme issues the real cert (typically within minutes of boot).
        openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
            -nodes -keyout "$LIVE_KEY" -out "$LIVE_FULLCHAIN" -days 365 \
            -subj "/CN=app.cp.worldwidewebb.co" \
            -addext "subjectAltName=DNS:app.cp.worldwidewebb.co,DNS:captive-portal.worldwidewebb.co" \
            >/dev/null 2>&1
    fi
fi

# Background loop: adopt the real cert (or a renewal) when it appears/changes on
# the volume, without a restart. Short interval so first issuance is picked up
# quickly; steady-state runs are cheap no-ops (cmp short-circuits).
(
    while true; do
        sleep 300 # 5m
        if sync_real_cert; then
            echo "portal-entrypoint: cert on volume changed, reloading nginx"
            nginx -s reload 2>/dev/null || true
        fi
    done
) &

exec nginx -g "daemon off;"
