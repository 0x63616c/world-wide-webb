# Structured logging

Backend logging goes through `packages/logger` (`@www/logger`), never
`console.*`. Library: pino.

## Where it's used

`api` and `worker` each call `createLogger({ service })` once at process
startup and hold the root logger; any code deeper in the call stack that
needs to log calls `getLogger()` instead of threading a logger instance
through every function. The `service` base field is `api` or `worker`
depending on which process is running the same shared code
(`packages/core`, `features/*`).

Levels: `pretty: true` (local dev) defaults to `debug`; JSON mode (prod)
defaults to `info`. An explicit `level` option overrides both.

## Redaction

`createLogger` sets pino's `redact` option to a fixed path list
(`REDACT_PATHS` in `packages/logger/src/index.ts`), replacing any matching
field's value with `[REDACTED]` before it ever reaches a transport. This
covers named secret-shaped fields (`HA_TOKEN`, `DATABASE_URL`,
`POSTGRES_PASSWORD`, `OP_SERVICE_ACCOUNT_TOKEN`, `GHCR_PULL_TOKEN`, the
private home-location coordinates, …), generic wrapper keys
(`token`/`secret`/`password`/`credential`/`accessToken`/`refreshToken`), auth
headers, and the two resolved-secret shapes platform code produces
(`resolvedValue`, `{ dockerName, value }`). `packages/logger/test/redact.test.ts`
is the source of truth for exactly what's covered — extend the list there
first, the redaction rule second.

The list is a defense-in-depth net, not a substitute for never passing a
secret value to the logger at all.

## Reading logs

Production logs are retained and rotated by Docker on the mini. Read them with
`docker --context orbstack logs` over SSH; see `docs/observability.md`. The old
Loki/Grafana stack is retired and archived. There is no separate frontend or
panel log store.
