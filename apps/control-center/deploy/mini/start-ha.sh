#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
python3 - <<'CHECK'
import socket
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.settimeout(2)
s.connect('/opt/homebrew/var/run/socket_vmnet')
s.close()
CHECK
colima start ha --activate=false --port-forwarder none
exec docker --context colima-ha compose -f /Users/calum/home-assistant/compose.yaml up -d --wait --wait-timeout 240
