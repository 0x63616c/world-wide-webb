#!/bin/sh
# Captive-portal container entrypoint (www-q002.14).
#
# The portal terminates TLS on :443 from /certs (the shared portal-certs volume,
# written by the portal-cert-renew acme.sh cron job). But on a FRESH deploy that
# volume is empty and the real Let's Encrypt cert has not been issued yet — nginx
# would refuse to start ("cannot load certificate"), crash-looping the whole
# service. So:
#
#   1. If the cert/key are missing, generate a throwaway SELF-SIGNED placeholder
#      so nginx (and the container healthcheck on :80) come up green immediately.
#      acme.sh replaces it with the real cert on its next run; the reload loop
#      below makes nginx pick that up without a restart.
#   2. Start a background loop that runs `nginx -s reload` every 6h, so a renewed
#      cert on the volume is adopted within hours (renewal fires ~30 days before
#      expiry, so the lag is harmless). No docker socket, no privileged signal —
#      the container reloads itself.
#   3. exec nginx in the foreground as PID 1.
set -eu

CERT_DIR=/certs
FULLCHAIN="$CERT_DIR/fullchain.pem"
KEY="$CERT_DIR/key.pem"

mkdir -p "$CERT_DIR"

if [ ! -s "$FULLCHAIN" ] || [ ! -s "$KEY" ]; then
    echo "portal-entrypoint: no cert on the volume yet — generating a self-signed placeholder"
    # 1-year self-signed so a long-lived placeholder (the real cert should land
    # within minutes of the first cron run) never itself expires into a crash.
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -nodes -keyout "$KEY" -out "$FULLCHAIN" -days 365 \
        -subj "/CN=captive-portal.worldwidewebb.co" >/dev/null 2>&1
fi

# Background reload loop: adopt a renewed cert without a restart. Survives in the
# same container as nginx; if nginx exits, the loop's reload no-ops harmlessly
# until the container is rescheduled.
(
    while true; do
        sleep 21600 # 6h
        nginx -s reload 2>/dev/null || true
    done
) &

exec nginx -g "daemon off;"
