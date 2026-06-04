#!/bin/sh
# bosun-agent entrypoint. Docker secrets are delivered as files under
# /run/secrets/<name>, but cli.ts reads process.env.BOSUN_WEBHOOK_TOKEN and the
# `op` CLI reads OP_SERVICE_ACCOUNT_TOKEN from the environment. Bridge the two by
# exporting each present secret file into the env before starting the receiver.
set -e

for name in BOSUN_WEBHOOK_TOKEN OP_SERVICE_ACCOUNT_TOKEN; do
  file="/run/secrets/$name"
  if [ -f "$file" ]; then
    export "$name=$(cat "$file")"
  fi
done

# `bosun up` (triggered on each webhook) loads ./deploy.config.ts from this cwd.
exec bun packages/bosun/src/cli.ts serve
