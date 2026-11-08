#!/bin/sh
set -eu
cd "$1"
/bin/rm -f -- homelab-host bootstrap.sh REVISION setup-plan.json SHA256SUMS host.age
cd /
/bin/rmdir -- "$1"
