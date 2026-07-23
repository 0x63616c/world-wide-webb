#!/usr/bin/env bash
set -euo pipefail
# The two 20-member unions must be gone after the retype. `type X = ... | ...`
# declarations named TileComponent/TileViewComponent are the red.
if rg -n "^\s*(export )?type (TileComponent|TileViewComponent)\b" apps/web/src/lib/tile-registry.ts; then
  echo "FAIL: union type aliases still present"; exit 1
fi
echo "OK: no tile component unions"
