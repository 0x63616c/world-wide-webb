#!/bin/bash
set -euo pipefail
src=/Users/calum/home-assistant/socket_vmnet-startup.plist
dst=/Library/LaunchDaemons/homebrew.mxcl.socket_vmnet.plist
/usr/bin/plutil -lint "$src"
test -f "$dst.pre-ha-migration" || /bin/cp -p "$dst" "$dst.pre-ha-migration"
/usr/bin/install -o root -g wheel -m 644 "$src" "$dst"
echo "Network helper will retry startup after reboot. Running helper left untouched."
