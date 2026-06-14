#!/usr/bin/env bash
#
# Provisions the OrbStack VM on homelab to the spec this stack needs (www-jagy).
# Run ON homelab, as calum (NOT sudo , `orb config` is per-user):
#
#   ./scripts/provision-orbstack.sh           # apply
#   ./scripts/provision-orbstack.sh --check    # report only, change nothing
#
# Idempotent. Codifies what was previously a manual `orb config set` so the VM
# sizing survives a reinstall and is reviewable. Applying a memory change needs an
# OrbStack restart , this script bounces it ONLY if the value actually changed,
# and only after confirming the host NFS mount is up first (see ordering note).

set -euo pipefail

# --- target spec -------------------------------------------------------------
# 5GB VM (memory_mib=5120): the box is 8GB, so this leaves ~3GB for macOS , about
# the safe ceiling (we already see host pageouts at 4GB; 6GB would thrash the
# host). The real protection against a single container eating the VM is the
# per-service memory caps in deploy.config.ts (www-ke9a), NOT VM size , this is
# headroom, not the fix.
TARGET_MEM_MIB="${TARGET_MEM_MIB:-5120}"
# vCPUs kept at 8 (all cores). Decision: an RCU-stall came from a container
# pegging all cores AND starving the guest kernel, but the memory caps + watchdog
# (www-sizh) address that more directly than under-provisioning CPU would; dropping
# to 6 only helps if macOS itself is starved, which it isn't. Revisit if the host
# (not the VM) shows CPU starvation.
TARGET_CPU="${TARGET_CPU:-8}"

NFS_MOUNT="/Users/calum/control-center/media"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

[ "$(id -u)" -ne 0 ] || { echo "FATAL: run as calum, NOT sudo (orb config is per-user)" >&2; exit 1; }
command -v orb >/dev/null || { echo "FATAL: orb (OrbStack CLI) not on PATH" >&2; exit 1; }

cur_mem="$(orb config show 2>/dev/null | awk '/memory_mib:/{print $2}')"
cur_cpu="$(orb config show 2>/dev/null | awk '/cpu:/{print $2}')"
echo "current: memory_mib=${cur_mem:-?} cpu=${cur_cpu:-?}  target: memory_mib=$TARGET_MEM_MIB cpu=$TARGET_CPU"

if [ "$CHECK_ONLY" -eq 1 ]; then
  [ "$cur_mem" = "$TARGET_MEM_MIB" ] && [ "$cur_cpu" = "$TARGET_CPU" ] && { echo "in spec"; exit 0; }
  echo "OUT OF SPEC (run without --check to apply)"; exit 1
fi

changed=0
[ "$cur_cpu" = "$TARGET_CPU" ] || { orb config set cpu "$TARGET_CPU"; changed=1; echo "set cpu=$TARGET_CPU"; }
[ "$cur_mem" = "$TARGET_MEM_MIB" ] || { orb config set memory_mib "$TARGET_MEM_MIB"; changed=1; echo "set memory_mib=$TARGET_MEM_MIB"; }

if [ "$changed" -eq 0 ]; then
  echo "already in spec , no restart needed"
  exit 0
fi

# ORDERING (www-6mz7): OrbStack must establish its file-share of the host NFS mount
# AFTER that NFS mount is up, or its container bind-mount of $NFS_MOUNT hangs and
# wedges dockerd (a SECOND, distinct 1033 cause we hit on 2026-06-09). So before
# restarting OrbStack to apply the config, confirm the host NFS mount is healthy.
echo "verifying host NFS mount before restarting OrbStack..."
if ! mount | grep -q " ${NFS_MOUNT} "; then
  echo "FATAL: $NFS_MOUNT is not mounted , run scripts/mount-homelab-drive.sh first" >&2
  echo "       (restarting OrbStack without the NFS mount up re-triggers www-6mz7)" >&2
  exit 1
fi
# Cheap liveness probe of the share itself (must not hang).
( ls "$NFS_MOUNT" >/dev/null 2>&1 ) & p=$!; sleep 5
if kill -0 "$p" 2>/dev/null; then kill -9 "$p" 2>/dev/null; echo "FATAL: $NFS_MOUNT hangs on ls , NFS share unhealthy, fix before restarting OrbStack" >&2; exit 1; fi

echo "host NFS healthy , restarting OrbStack to apply config..."
orb restart
echo "done. verify: orb config show ; docker run --rm -v $NFS_MOUNT:/m alpine ls /m"
