#!/usr/bin/env bash
# Run Apple UI tooling in this user's existing desktop, preserving step inputs.
set -euo pipefail
(($# > 0)) || { echo 'Usage: apple-desktop.sh <command> [arguments...]' >&2; exit 64; }
if [[ $(uname -s) != Darwin ]]; then exec "$@"; fi
apple_desktop_uid=$(/usr/bin/id -u)
apple_desktop_user=$(/usr/bin/id -un)
[[ "$apple_desktop_uid" != 0 ]] || { echo 'Run Apple UI checks as the developer user.' >&2; exit 64; }
if [[ $(/bin/launchctl managername) == Aqua ]]; then exec "$@"; fi
/bin/launchctl print "gui/$apple_desktop_uid" >/dev/null 2>&1 || {
  echo 'Apple UI checks require an existing desktop session for this user.' >&2
  exit 69
}
# asuser changes the bootstrap namespace, not the Unix identity. Drop back to
# the same user before executing the command; no root job or launch agent stays.
exec /usr/bin/sudo -n -E /bin/launchctl asuser "$apple_desktop_uid" \
  /usr/bin/sudo -n -E -u "$apple_desktop_user" -- /usr/bin/env "PATH=$PATH" "$@"
