#!/usr/bin/env bash
# Install on the mini from the exact CI-tested revision; no tunnel restart.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
generation="${1:?tested workflow run number required}"
[[ "$generation" =~ ^[0-9]{1,12}$ ]] || exit 64
generation=$((10#$generation))
root=/Users/calum/www-tunnel/recovery
label=com.calum.tunnel-recovery
plist="/Users/calum/Library/LaunchAgents/$label.plist"
service="gui/$(id -u)/$label"
test "$HOME" = /Users/calum
/usr/bin/python3 -m py_compile "$source_dir/tunnel_watchdog.py"
/usr/bin/plutil -lint "$source_dir/$label.plist"
mkdir -p "$root" "$(dirname "$plist")"
last=0
if [[ -f "$root/generation" ]]; then last=$(cat "$root/generation"); fi
[[ "$last" =~ ^[0-9]+$ ]] || exit 65
if ((generation < last)); then
  echo 'Tunnel recovery installation superseded by a newer tested revision.'
  exit 0
fi
record_generation() {
  printf '%s\n' "$generation" > "$root/generation.tmp"
  mv "$root/generation.tmp" "$root/generation"
}
# Preserve state and cooldown across upgrades; leave an identical job running.
if cmp -s "$source_dir/tunnel_watchdog.py" "$root/tunnel_watchdog.py" \
  && cmp -s "$source_dir/$label.plist" "$plist" \
  && launchctl print "$service" > /dev/null 2>&1; then
  record_generation
  echo 'Tunnel recovery already installed and loaded.'
  exit 0
fi
install -m 644 "$source_dir/tunnel_watchdog.py" "$root/tunnel_watchdog.py.tmp"
mv "$root/tunnel_watchdog.py.tmp" "$root/tunnel_watchdog.py"
install -m 644 "$source_dir/$label.plist" "$plist.tmp"
mv "$plist.tmp" "$plist"
if launchctl print "$service" > /dev/null 2>&1; then
  launchctl bootout "$service"
fi
launchctl enable "$service"
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl print "$service" > /dev/null
record_generation
echo 'Tunnel recovery installed and loaded (30-second interval).'
