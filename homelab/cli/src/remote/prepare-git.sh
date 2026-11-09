#!/bin/sh
set -eu
cd "$1"
actual=$(/usr/bin/shasum -a 256 homelab-host)
[ "${actual%% *}" = "$2" ]
exec ./homelab-host "$6" --repository "$3" --host "$4" --attempt "$5"
