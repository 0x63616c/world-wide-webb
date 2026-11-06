# Cloudflare tunnel recovery on the mini

Two power cuts on November 5, 2026 left Control Center healthy locally while
cloudflared kept retrying `192.168.1.254:7844`, the AT&T gateway rather than a
Cloudflare edge address. The second incident persisted for 27 minutes after
boot. DNS was correct by inspection time; restarting only cloudflared restored
all four connections. Page requests did not trigger recovery. Docker's
`unless-stopped` policy cannot repair a disconnected process that stays running.

`deploy/mini/tunnel_watchdog.py` now checks the connector's local
`http://127.0.0.1:20241/ready` endpoint. A 200 means the connector has a ready
Cloudflare connection. An unauthenticated 302 from a public app hostname only
proves that Access is answering; it does not prove that the tunnel works.

## Recovery behavior

The `com.calum.tunnel-recovery` user LaunchAgent runs at load and every 30 seconds
in the mini's existing login session, alongside OrbStack. It uses macOS's
`/usr/bin/python3`, with no extra dependencies.

- Allow 120 seconds after each container start before counting failed probes.
- Require three consecutive failed readiness checks. A successful check resets
  the count; the first restart is normally about 3–3.5 minutes after startup.
- Restart only `www-tunnel-cloudflared-1`, by its observed container ID. Recheck
  its identity and state immediately before acting.
- Leave missing, deliberately stopped, paused, or restarting containers alone.
  A Docker error or hang does not trigger a broader restart.
- Persist a five-minute cooldown before each restart attempt, including failed
  or timed-out attempts. Keep it across container replacements and upgrades.
- Bound Docker inspections to 10 seconds, HTTP probes to 5 seconds, and restart
  commands to 30 seconds. A file lock prevents overlapping manual/scheduled runs.

The check does not restart OrbStack, the app, databases, Home Assistant,
Hindsight, or Bambuddy. The existing Docker-engine watchdog remains independent.
Recovery continues retrying through an internet outage; it cannot restore
connectivity until the upstream network works again.

## Deployment and inspection

After successful main CI and the app release, `deploy-mini.yml` copies the script,
plist, and installer from the exact tested checkout to the mini. The installer
atomically replaces the files and loads the LaunchAgent. Identical installations
are left running, and an older workflow generation cannot replace newer files.
No tunnel credentials are read, copied, or changed by recovery.

```sh
ssh homelab 'launchctl print gui/$(id -u)/com.calum.tunnel-recovery'
ssh homelab 'cat /Users/calum/www-tunnel/recovery/state.json'
ssh homelab 'tail -20 /Users/calum/www-tunnel/recovery/recovery.log'
ssh homelab 'curl -fsS http://127.0.0.1:20241/ready'
```

Healthy checks are quiet. The local JSON event log rotates at 1 MiB with two
retained files; there are no alerts. `state.json` is versioned recovery state,
not a credential file: it records the observed container generation, failure
count, and last restart attempt. An absent or invalid file starts a fresh
failure count.

To suspend automatic recovery during maintenance, unload its job:

```sh
ssh homelab 'launchctl bootout gui/$(id -u)/com.calum.tunnel-recovery'
```

Load it again after maintenance:

```sh
ssh homelab 'launchctl bootstrap gui/$(id -u) /Users/calum/Library/LaunchAgents/com.calum.tunnel-recovery.plist'
```

The next successful deployment also restores a missing job. Stopping or pausing
the tunnel container itself is respected even while recovery remains loaded.

## Validation

`python3 -m unittest discover -s deploy/mini -p 'test_*.py'` runs the existing
backup safety checks plus recovery scenarios. Recovery tests use temporary state
and simulated Docker/HTTP responses, including the actual nanosecond timestamp
format from Docker on macOS. They do not interrupt production. The deployment
contract is checked by `bash scripts/test-deploy-gate.sh`; installer syntax and
plist validity can also be checked with `bash -n` and `plutil -lint`.
