# Structured logging

The Rust service uses `tracing` with JSON output configured in `server/src/main.rs`.
Record bounded operational metadata and error categories; never log credentials, request bodies,
PINs or private media. Request IDs and worker state belong in structured fields.

Use rotated container logs and `/healthz` for production debugging. See [observability](observability.md)
for commands and [backup recovery](runbooks/mini-backups.md) for database handling.

The panel's Settings → Diagnostics shows "Mini status" and "Mini logs": redacted tails that
Homelab exports into the read-only `HOST_STATUS_DIR` (see Homelab's backups doc). The server
never reads Docker or the host directly.
