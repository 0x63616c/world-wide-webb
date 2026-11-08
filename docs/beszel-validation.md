# Beszel deployment checks

Observed 2026-11-08, after deploying homelab revision `0bf8d4ce`.

## Working

- Both systems report `up`; historical samples are accumulating.
- Native agents run as `_monitor` (UID/GID 452). Each listens only on its
  Tailscale IPv4 address, port 45876.
- Reported physical memory matches the hosts: 8 GiB Mini, 32 GiB MacBook.
- Measured agent RSS: approximately 13 MiB Mini and 25 MiB MacBook.
- Hub container memory sample: 11.89 MiB, with its 128 MiB limit applied.
- Saved Beszel credentials authenticate successfully. Unauthenticated system
  listing returns no records.
- Beszel-only cold snapshot, service recovery and NAS upload/readback passed:
  `20261108T200922Z-3aa58ba9`.
- Python backup/reconciliation tests, Rust health checks, all Compose models,
  both Darwin system builds and Cloudflare infrastructure tests passed.

## Deployment access

Cloudflare state belongs on the Mini. Its deployment identity is `tag:ci`;
the Mini alone additionally has `tag:infra-owner`. Tailscale SSH permits
that identity to connect as `admin` only to the latter tag. The MacBook does
not have it. Tag ownership remains with tailnet administrators.

After replacing or re-enrolling the state owner, an administrator must restore
that control-plane tag before the Cloudflare deployment workflow can connect.
This role does not require an ordinary SSH authorized key.

## Remaining checks

- Isolated restore must verify saved login, hub identity and historical samples.
- Publish the Access-protected endpoint and verify its access gate.
- Transfer encrypted OpenTofu state and recovery credentials to the Mini and
  verify the updated deployment workflow.

No host reboot was needed for monitoring. Other services and runner assignments
were retained.
