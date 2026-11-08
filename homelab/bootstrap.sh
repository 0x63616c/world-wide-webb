#!/bin/bash
# Keep bootstrap policy in the typed operation shared with the operator client.
set -euo pipefail
directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
if [ ! -x "$directory/homelab-host" ]; then
  echo 'Use the reviewed bootstrap artifact, with homelab-host beside this wrapper.' >&2
  exit 1
fi
exec "$directory/homelab-host" bootstrap "$@"
