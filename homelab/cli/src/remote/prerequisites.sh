#!/bin/sh
set -eu
export LC_ALL=C
/usr/sbin/dseditgroup -o checkmember -m "$(/usr/bin/id -un)" admin | /usr/bin/grep -q '^yes ' || exit 10
/usr/bin/xcode-select --print-path >/dev/null 2>&1 || exit 11
/usr/bin/git --version >/dev/null 2>&1 || exit 11
