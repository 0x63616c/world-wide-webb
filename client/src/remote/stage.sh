#!/bin/sh
set -eu
umask 077
/usr/bin/mktemp -d /private/tmp/homelab-setup.XXXXXXXX
