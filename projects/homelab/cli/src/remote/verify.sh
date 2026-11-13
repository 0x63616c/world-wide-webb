#!/bin/sh
set -eu
cd "$1"
/usr/bin/shasum -a 256 -c SHA256SUMS > /dev/null
