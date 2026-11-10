#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
bun test Tests
case "${1:-all}" in
  javascript) ;;
  all)
    python3 -m unittest discover -s Tests -p 'test_*.py'
    swift Tests/WebKitSmoke.swift "$root/Extension"
    bash Scripts/build.sh macos CODE_SIGNING_ALLOWED=NO
    bash Scripts/build.sh simulator CODE_SIGNING_ALLOWED=NO
    ;;
  *) echo 'Usage: Scripts/check.sh [javascript|all]' >&2; exit 64 ;;
esac
