#!/usr/bin/env bash
# Install the captive-portal :443 LAN forward as a root LaunchDaemon (www-j934.20).
#
# The homelab mini has NO repo checkout (it runs k8s via OrbStack; deploys via CI),
# so host runtime scripts live in the home dir, same as com.calum.k8s-apiserver-forward.
# Stage the two artifacts into $HOME first (from a machine that has the repo):
#   scp scripts/portal-443-forward.sh homelab:~/portal-443-forward.sh
#   scp apps/captive-portal/deploy/com.calum.portal-443-forward.plist homelab:~/
#   scp apps/captive-portal/deploy/install-portal-443-forward.sh homelab:~/
# then run THIS on the mini with a tty for sudo:
#   ssh -t homelab 'bash ~/install-portal-443-forward.sh'
set -euo pipefail

SCRIPT_SRC="$HOME/portal-443-forward.sh"
PLIST_SRC="$HOME/com.calum.portal-443-forward.plist"
SCRIPT_DST="$HOME/portal-443-forward.sh"   # plist ProgramArguments points here
PLIST_DST="/Library/LaunchDaemons/com.calum.portal-443-forward.plist"
LABEL="com.calum.portal-443-forward"

[ -f "$SCRIPT_SRC" ] || { echo "missing $SCRIPT_SRC (scp it first)" >&2; exit 1; }
[ -f "$PLIST_SRC" ]  || { echo "missing $PLIST_SRC (scp it first)" >&2; exit 1; }
chmod +x "$SCRIPT_DST"

# LaunchDaemons must be root-owned. Re-bootstrap if already loaded (idempotent).
sudo cp "$PLIST_SRC" "$PLIST_DST"
sudo chown root:wheel "$PLIST_DST"
sudo chmod 644 "$PLIST_DST"
sudo launchctl bootout system/"$LABEL" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST_DST"
sudo launchctl enable system/"$LABEL"

echo "installed $LABEL"
echo "verify: curl -skI https://192.168.0.147:443 -H 'Host: captive-portal.worldwidewebb.co'"
