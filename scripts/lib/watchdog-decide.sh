#!/usr/bin/env bash
#
# Shared watchdog decision logic. Sourced by scripts/orbstack-watchdog.sh and
# scripts/ha-watchdog.sh; it defines a function and nothing else, so sourcing it
# has no side effects.
#
# WHY SHARED: both watchdogs answer the identical question , "this thing has
# failed N probes in a row; do I act, wait, or hold off because I only just
# restarted it?" , and the anti-loop property is the part that must never be
# subtly different between them. A watchdog that can restart in a tight loop is
# worse than no watchdog at all, so the rule lives in exactly one place with one
# test matrix rather than being copy-pasted per service. Expect more probes than
# these two.
#
# Tested hermetically by scripts/test-orbstack-watchdog.sh and
# scripts/test-ha-watchdog.sh.

# wd_decide <consec> <threshold> <secs_since_last_restart> <cooldown>
#   echoes exactly one of: ok | watch | cooldown | restart
#   - ok       : last probe healthy (consec == 0)
#   - watch    : some failures but below threshold , keep watching, don't act
#   - cooldown : threshold reached but a restart happened too recently , hold off
#   - restart  : threshold reached AND cooldown elapsed , recover now
wd_decide() {
  local consec="$1" threshold="$2" since="$3" cooldown="$4"
  if [ "$consec" -lt "$threshold" ]; then
    [ "$consec" -le 0 ] && echo "ok" || echo "watch"
    return 0
  fi
  if [ "$since" -lt "$cooldown" ]; then echo "cooldown"; else echo "restart"; fi
}
