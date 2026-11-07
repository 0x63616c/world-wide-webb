#!/bin/sh
set -eu
cd "$1"
actual=$(/usr/bin/shasum -a 256 homelab-host)
[ "${actual%% *}" = "$2" ]
exec /usr/bin/sudo -n -- ./homelab-host install-developer-tools
