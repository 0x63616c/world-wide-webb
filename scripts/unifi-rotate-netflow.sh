#!/bin/bash
# Daily rotation of the UniFi NetFlow capture, so it mirrors the syslog daily files
# instead of one unbounded flows.json. goflow2 holds the flows.json fd open, so we
# rename + restart the container to make it reopen a fresh file, then gzip the closed
# day. Deployed to the NAS at /volume1/Unifi/docker/unifi-rotate-netflow.sh and run by
# DSM Task Scheduler daily at 23:59. www-dhi9.
#
# Retention: RETENTION_DAYS=0 (default) keeps everything FOREVER (decision pending a
# real volume measurement). Set it >0 later to prune old archives in BOTH streams.
set -e
D=/usr/local/bin/docker
NF=/volume1/Unifi/logs/netflow
SL=/volume1/Unifi/logs/syslog
STAMP=$(date +%F)

if [ -s "$NF/flows.json" ]; then
  mv "$NF/flows.json" "$NF/$STAMP-flows.json"
  $D restart unifi-netflow >/dev/null
  gzip -f "$NF/$STAMP-flows.json"
fi

RET="${RETENTION_DAYS:-0}"
if [ "$RET" -gt 0 ]; then
  find "$NF" -name '*-flows.json.gz' -mtime +"$RET" -delete
  find "$SL" -name 'unifi-*.log'     -mtime +"$RET" -delete
fi
