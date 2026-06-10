#!/bin/sh
# bosun-agent entrypoint. Docker secrets are delivered as files under
# /run/secrets/<name>, but cli.ts reads process.env.BOSUN_WEBHOOK_TOKEN and the
# `op` CLI reads OP_SERVICE_ACCOUNT_TOKEN from the environment. Bridge the two by
# exporting each present secret file into the env before dispatching.
#
# Two run shapes share ONE image:
#   - no args  → the resident webhook server (`serve`), secrets mounted as files.
#   - args     → a one-shot command, e.g. `docker run <image> up` (CC-fmws). The
#     one-shot has NO /run/secrets mount; it forwards the same secrets via
#     `docker run -e NAME` from the agent's env, so the export below must leave an
#     already-set env var untouched when the secret file is absent (the `[ -f ]`
#     guard does exactly this — no file means no overwrite).
set -e

# CF_ACCESS_*_CLIENT_ID are the (non-secret) CF Access service-token client-ids
# (CC-cuuw). They ride the docker-secret channel like the other CF_* ids; the
# `[ -f ]` guard below leaves them unset until the matching 1Password items exist
# (created by scripts/save-cf-access-tokens.sh at the gated cutover) — absent
# files are simply skipped, so this is inert until then.
for name in BOSUN_WEBHOOK_TOKEN OP_SERVICE_ACCOUNT_TOKEN GHCR_PULL_TOKEN \
            CF_ACCOUNT_ID CF_ZONE_ID CF_TUNNEL_ID \
            CF_ACCESS_KIOSK_CLIENT_ID CF_ACCESS_CI_CLIENT_ID \
            CF_ACCESS_ALLOWED_EMAIL; do
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

# Dispatch: any args run that bosun subcommand once (one-shot, e.g. `up`); no
# args start the resident webhook server. Both load ./deploy.config.ts from cwd.
if [ "$#" -gt 0 ]; then
  exec bun packages/bosun/src/cli.ts "$@"
else
  exec bun packages/bosun/src/cli.ts serve
fi
