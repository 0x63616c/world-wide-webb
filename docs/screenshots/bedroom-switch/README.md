# Offline verification evidence

`tests.png` is a Chromium screenshot at 1366×1024 of actual saved command output:
full offline unit suite, the in-flight party regression, lint, typecheck, and
`apps:check`. No app server, Home Assistant, or devices were contacted.
In that earlier run, the optional PostgreSQL/integration suites were skipped
without their prerequisites.

`hardening.png` records the follow-up run with disposable PostgreSQL 17 on port
55428: all 43 core PG contracts, two bedroom transaction contracts, full unit
suite, official API migration, and table/primary-key inspection. It also records
the central verify path/stale-entry limitations and unavailable GitHub credentials.
No production HA/device calls were made; activation remains off.
