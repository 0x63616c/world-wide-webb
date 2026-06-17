#!/usr/bin/env bash
set -euo pipefail

# Saves the Synology "Homelab drive" connection details to the SOPS vault
# so the api can mount it into the media-worker container, keeping the
# NAS IP/credentials OUT of this (public) repo. (www-kp4k.7)
#
# Recommended: NFS (no password, IP-allowlisted on the NAS, robust for Linux containers).
# SMB also supported (needs the Synology user you're creating).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Synology 'Homelab drive' -> SOPS vault =="
echo

# --- protocol ---------------------------------------------------------------
echo "Protocol:"
echo "  1) nfs   (recommended, Control Panel > File Services > NFS > Enable;"
echo "           then the shared folder > Edit > NFS Permissions > add a rule for"
echo "           the Mac Mini's IP, Squash = 'Map all users to admin', read/write)"
echo "  2) smb   (uses the Synology user you're creating)"
read -rp "Choose [1/2] (default 1): " P; P="${P:-1}"
if [ "$P" = "2" ]; then PROTOCOL="smb"; else PROTOCOL="nfs"; fi
echo "  -> $PROTOCOL"
echo

# --- host -------------------------------------------------------------------
read -rp "NAS LAN IP or hostname (e.g. 192.168.1.50): " HOST
[ -n "$HOST" ] || { echo "FATAL: empty host" >&2; exit 1; }

# --- share path -------------------------------------------------------------
if [ "$PROTOCOL" = "nfs" ]; then
  echo "NFS export path (Synology shows it as the 'Mount path' in NFS Permissions,"
  echo "  typically /volume1/<shared-folder>, e.g. /volume1/control-center)"
  read -rp "Export path: " SHARE
else
  echo "SMB share name (the shared folder name, e.g. control-center)"
  read -rp "Share name: " SHARE
fi
[ -n "$SHARE" ] || { echo "FATAL: empty share" >&2; exit 1; }

# --- write to vault ---------------------------------------------------------
echo "$PROTOCOL" | "$REPO_ROOT/scripts/set-secret.sh" HOMELAB_DRIVE__PROTOCOL
echo "$HOST"     | "$REPO_ROOT/scripts/set-secret.sh" HOMELAB_DRIVE__HOST
echo "$SHARE"    | "$REPO_ROOT/scripts/set-secret.sh" HOMELAB_DRIVE__SHARE

echo
echo "Stored vault keys: HOMELAB_DRIVE__PROTOCOL, HOMELAB_DRIVE__HOST, HOMELAB_DRIVE__SHARE"
echo
echo "Free space target: the 92-video playlist at 1080p AV1 is ~108GB; 1TB is ample."
