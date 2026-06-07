#!/bin/sh
# bosun-agent entrypoint. Docker secrets are delivered as files under
# /run/secrets/<name>, but cli.ts reads process.env.BOSUN_WEBHOOK_TOKEN and the
# `op` CLI reads OP_SERVICE_ACCOUNT_TOKEN from the environment. Bridge the two by
# exporting each present secret file into the env before starting the receiver.
set -e

for name in BOSUN_WEBHOOK_TOKEN OP_SERVICE_ACCOUNT_TOKEN GHCR_PULL_TOKEN \
            CF_ACCOUNT_ID CF_ZONE_ID CF_TUNNEL_ID; do
  file="/run/secrets/$name"
  if [ -f "$file" ]; then
    export "$name=$(cat "$file")"
  fi
done

# Log in to GHCR so `docker stack deploy --with-registry-auth` (run by `bosun up`
# on each webhook) bundles valid pull creds — otherwise pulling an updated image
# fails with "No such image". The agent container has no docker config otherwise.
if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u 0x63616c --password-stdin >/dev/null 2>&1 \
    && echo "[bosun serve] logged in to ghcr.io" \
    || echo "[bosun serve] WARNING: ghcr.io login failed — deploys may not pull new images"
fi

# `bosun up` (triggered on each webhook) loads ./deploy.config.ts from this cwd.
exec bun packages/bosun/src/cli.ts serve
