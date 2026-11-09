#!/usr/bin/env bash
# Boots a simulator and waits until it is ready, giving up after a time limit so a stuck boot
# cannot hang a CI job. Usage: scripts/boot-simulator.sh <udid> [timeout-seconds, default 300]
set -euo pipefail
udid=${1:?usage: boot-simulator.sh <udid> [timeout-seconds]}
limit=${2:-300}

xcrun simctl boot "$udid" 2>/dev/null || true # already booted is fine
xcrun simctl bootstatus "$udid" -b >/dev/null &
waiter=$!
for ((second = 0; second < limit; second++)); do
  if ! kill -0 "$waiter" 2>/dev/null; then
    wait "$waiter"
    exit
  fi
  sleep 1
done
kill "$waiter" 2>/dev/null || true
echo "::error::Simulator $udid did not finish booting within ${limit}s" >&2
exit 1
