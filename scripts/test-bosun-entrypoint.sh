#!/usr/bin/env bash
# Hermetic test for packages/bosun/docker-entrypoint.sh (CC-vqyv / CC-fmws).
#
# Stubs `bun` and `docker` on PATH so nothing real runs: the fake `bun` records
# the cli.ts subcommand it was exec'd with, the fake `docker` is a no-op for the
# ghcr login. Asserts:
#   - no args            -> dispatches `serve` (the resident webhook server)
#   - args (`up`)        -> dispatches the one-shot subcommand verbatim
#   - secret FILE present -> exported to env
#   - secret file ABSENT but env already set -> env left untouched (one-shot path,
#     where secrets are forwarded via `docker run -e NAME`, not mounted as files)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRYPOINT="$REPO_ROOT/packages/bosun/docker-entrypoint.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/secrets"

# fake bun: print the args it was called with, then exit 0 (the entrypoint
# `exec`s it, so this is the last thing that runs).
cat >"$TMP/bin/bun" <<'EOF'
#!/usr/bin/env bash
echo "BUN_ARGS: $*"
# Surface a couple of env vars so the test can assert export behavior.
echo "ENV_OP=${OP_SERVICE_ACCOUNT_TOKEN:-<unset>}"
echo "ENV_CF_ACCOUNT=${CF_ACCOUNT_ID:-<unset>}"
exit 0
EOF
chmod +x "$TMP/bin/bun"

# fake docker: no-op (the ghcr login path).
cat >"$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP/bin/docker"

pass=0
fail=0
check() { # desc expected actual
  if echo "$3" | grep -qF "$2"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $1"
    echo "  expected to contain: $2"
    echo "  got:"
    printf '    %s\n' "$3"
  fi
}

# A copy of the entrypoint with the hardcoded /run/secrets path pointed at the
# temp dir, so a "mounted secret" is just a file we drop in $TMP/secrets.
EP="$TMP/entrypoint.sh"
sed "s#/run/secrets#$TMP/secrets#g" "$ENTRYPOINT" >"$EP"

run_ep() { # env-assignments... -- script-args...
  local env_kv=()
  while [ "$1" != "--" ]; do env_kv+=("$1"); shift; done
  shift
  ( cd "$REPO_ROOT" && env PATH="$TMP/bin:$PATH" "${env_kv[@]}" sh "$EP" "$@" )
}

# 1. No args -> serve, with a mounted secret file exported.
printf 'tok-from-file' >"$TMP/secrets/OP_SERVICE_ACCOUNT_TOKEN"
out="$(run_ep --)"
check "no args dispatches serve" "BUN_ARGS: packages/bosun/src/cli.ts serve" "$out"
check "mounted secret file is exported" "ENV_OP=tok-from-file" "$out"
rm -f "$TMP/secrets/OP_SERVICE_ACCOUNT_TOKEN"

# 2. Args -> one-shot subcommand verbatim.
out="$(run_ep -- up)"
check "args dispatch the one-shot subcommand" "BUN_ARGS: packages/bosun/src/cli.ts up" "$out"

# 3. Secret file ABSENT but env already set -> env preserved (one-shot path,
#    where secrets arrive via `docker run -e NAME`, not as mounted files).
out="$(run_ep CF_ACCOUNT_ID=acct-from-env -- up)"
check "absent file leaves pre-set env untouched" "ENV_CF_ACCOUNT=acct-from-env" "$out"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
