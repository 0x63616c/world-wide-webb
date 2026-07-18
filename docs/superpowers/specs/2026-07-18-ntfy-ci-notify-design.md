# ntfy CI Notification — Design

**Date:** 2026-07-18
**Status:** Approved

## Goal

Push a phone notification (via ntfy.sh) when CI on `main` fails, and a quiet
ping when a deploy succeeds. Smallest possible integration: one new job in
`ci.yml`, no app code, no infra changes.

## Decisions

- **Trigger:** CI pipeline results on `main` only. Feature branches and PRs
  stay silent.
- **Server:** public `ntfy.sh`. The topic name is the secret, stored in the
  SOPS vault as `NTFY_TOPIC` (with the other CI secrets). The notify job
  therefore uses the protected `prod` environment to get `AGE_PRIVATE_KEY`,
  same as deploy — main-only, so the key still never reaches PR runners.
- **Delivery:** subscribe to the topic in the ntfy iOS/Android app.

## Architecture

One new terminal job in `.github/workflows/ci.yml`:

```yaml
notify:
  needs: [changes, test, typecheck, build-web, build-api, build-worker,
          build-media-worker, build-storybook, build-drizzle,
          build-captive-portal, build-captive-portal-api,
          build-map-provision, deploy]
  if: always() && github.ref_name == 'main'
  runs-on: ubuntu-latest
  timeout-minutes: 5
  environment: prod   # AGE_PRIVATE_KEY to decrypt vault for NTFY_TOPIC
```

Logic inside a single step:

1. **Any needed job failed** (`contains(needs.*.result, 'failure')`) →
   high-priority message:
   - `Priority: high`, `Tags: rotating_light`
   - Body: `CI failed on main: <commit subject> (<short sha>)`
   - `Click:` header → the workflow run URL.
2. **Deploy succeeded** (`needs.deploy.result == 'success'`) → low-priority
   `Priority: low`, `Tags: rocket` message: `deployed <short sha>: <commit subject>`.
3. **Otherwise** (deploy skipped, nothing failed — e.g. docs-only push) →
   send nothing.

## Error handling

- `curl -fsS --max-time 10 ... || true` — a notify failure never fails CI.
- Missing `NTFY_TOPIC` secret → step no-ops (guard on empty env var).

## Testing

- Push the change; verify a real deploy run sends the success ping.
- Manual check of failure path: temporarily not required — the expression
  logic mirrors the existing `deploy` gate, and worst case is a missing
  notification, not a broken pipeline.

## Out of scope

- Worker/cron failure alerts, app-domain events (device offline, media jobs).
- Self-hosted ntfy server.
- Notifications for non-`main` branches.
