#!/usr/bin/env bash
# Bootstrap the beads issue DB on a fresh clone (www-sg4p).
#
# Issues live in a Dolt DB synced via the Dolt *git remote*: refs/dolt/data on
# origin. A fresh clone has no DB — this script reconstructs it from origin. No
# reliance on committed JSONL (issues.jsonl is a gitignored export, not the
# sync channel).
#
# Order matters: the tracked .beads/metadata.json pins `dolt_mode: server`, so a
# Dolt server must be running BEFORE `bd bootstrap` (running bootstrap first in
# server mode fails with "reconcile shared-server metadata: dial 127.0.0.1:0").
#   1. bd dolt start  -> starts a per-project Dolt server (creates the port file)
#   2. bd bootstrap   -> auto-detects origin, clones refs/dolt/data into the server
#   3. auto-push off  -> per-write auto-push livelocks under parallel agents
#                        contending on the shared parent .git; sync rides the
#                        lefthook pre-push hook (`bd dolt push`) instead.
#
# Idempotent: safe to re-run. Bootstrap never deletes existing issues.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v bd >/dev/null 2>&1; then
  echo "bootstrap-beads: 'bd' (beads) is not installed — see .beads/README.md" >&2
  exit 1
fi

echo "bootstrap-beads: starting Dolt server (server mode)…"
bd dolt start

echo "bootstrap-beads: syncing issue DB from origin (refs/dolt/data)…"
bd bootstrap --yes

echo "bootstrap-beads: disabling dolt.auto-push (sync rides lefthook pre-push)…"
bd config set dolt.auto-push false >/dev/null

count="$(bd list --json 2>/dev/null | grep -c '"id"' || true)"
echo "bootstrap-beads: done — ${count} issues available. Try: bd ready"
