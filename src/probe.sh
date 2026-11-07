#!/bin/sh
set -eu
/usr/bin/sw_vers -productVersion
/usr/bin/uname -m
/usr/bin/id -un
/usr/bin/id -u
/bin/df -Pk / | /usr/bin/tail -n 1 | /usr/bin/awk '{print $4; print $2}'
