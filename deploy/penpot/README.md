# Shared Penpot on the Mac mini

One Penpot 2.18.6 instance supports separate projects/files for any app at
https://penpot.worldwidewebb.co. Its source belongs here alongside the other
independent homelab services; app repositories keep their own skills/design exports.

Penpot is separate from the native Control Center API. OpenTofu adds its DNS,
email-gated Access application and one ingress rule to the existing tunnel.
The container port is loopback-only. No new tunnel, public port, service-token
bypass or Tailscale Funnel is needed. The native app remains Tailscale-only.

## Install

Install these configuration files in `/Users/calum/penpot` on the mini. Copy
`deploy/mini/penpot_provision.py` and `deploy/mini/penpot_backup.py` there as
`provision.py` and `backup.py`. OrbStack already starts
at login. Run `python3 provision.py` once to generate private database/session
keys in `runtime.env` (mode 0600); reruns preserve them. Never commit that file.

For initial account creation only:

```sh
docker --context orbstack compose --env-file runtime.env -f compose.yaml -f bootstrap.yaml up -d
```

The bootstrap overlay enables Penpot's management REPL **inside the backend's
loopback namespace only**. Use `docker exec -i penpot-penpot-backend-1 python3`
to send the upstream `create-profile` management command to port 6063, passing
the password through stdin in memory. Then return to normal configuration:

```sh
docker --context orbstack compose --env-file runtime.env -f compose.yaml up -d
```

Verify the REPL is disabled and the account logs in before publishing ingress.
Registration, outbound email and telemetry remain disabled. The owner's account
uses the owner's saved email; its login is saved in 1Password as
`penpot.worldwidewebb.co`, with the final URL. No default password is used.

Images are version-pinned, logs rotate and containers restart independently.
Explicit memory caps protect the mini's other services; check real memory use
and exports after installation. Backend heap is bounded to 640 MiB. Export
concurrency is one. MCP transport access logs are disabled because their URLs
contain agent credentials. Do not restart OrbStack or unrelated containers to deploy this.

## Agent connection

The integrated MCP uses the browser's active file. Connect **File → MCP Server →
Connect** and leave that tab open. Browser traffic uses the existing Access gate.
An agent can reach the same backend over an SSH loopback forward, avoiding a
second public authentication bypass. Its Penpot MCP key stays in the client's
private configuration/1Password. Never put token-bearing URLs in a repo or logs.
The first tool call is `high_level_overview`, followed by a read-only structure
query before writes. Verify a reversible edit and exported image before calling
the connection ready.

## Backup and recovery

Install `com.calum.penpot-backup.plist` into the mini's user LaunchAgents and load
it with `launchctl bootstrap gui/$(id -u) ...`. It runs at 05:15, separately from
the existing 04:15 homelab backup. Running `python3 backup.py` manually creates a
consistent database/assets/instance snapshot, briefly quiescing only Penpot's
backend and exporter. It reuses the existing certificate-pinned NAS uploader and
credentials, and writes `NAS_VERIFIED` only after every upload/read-back succeeds.
Seven verified local sets are retained; incomplete sets and NAS copies remain.
Private backups contain instance secrets and must stay in restricted recovery storage.

A restore needs all three files: `penpot.dump`, `assets.tar.gz`, `instance.tar.gz`.
Verify gzip/tar integrity and restore the database into an isolated PostgreSQL 15
container first. Validate actual design/account counts, not just archive headers.
For live recovery, stop this stack, preserve its existing volumes, restore instance
configuration and assets, restore PostgreSQL with `pg_restore`, then start and
check the account, editable files, exports and MCP. Never use `down -v` as a
routine restart: it destroys the design volumes.

Runtime verification is recorded separately after deployment. Source configuration
and local tests alone do not establish domain, backup restore or design acceptance.
