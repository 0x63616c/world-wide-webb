#!/usr/bin/env bash
# Compatibility array output; new callers use scripts/affected directly.
set -euo pipefail
cd "$(dirname "$0")/.."
base=${1:-}
if (($#)); then shift; fi
intent=verify
options=()
while (($#)); do
  case "$1" in
    --build) intent=ship ;;
    --only) options+=(--only "${2:?--only needs a key}"); shift ;;
    *) echo "Unknown option $1" >&2; exit 64 ;;
  esac
  shift
done
scripts/affected "$base" --intent "$intent" "${options[@]}" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["apps"], separators=(",", ":")))'
