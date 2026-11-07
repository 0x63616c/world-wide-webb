# Availability watchdog implementation checkpoint

Implemented as an isolated Rust Worker and D1 database, with OpenTofu module calls in staging/production disabled by default. The shared D1 checksum migration wrapper now accepts explicit `--database-kind watchdog`; the existing application default and ledger protocol are unchanged. Config generation enforces exact environment/database identities and restricts mail to the verified owner destination.

Behavior: one-minute scheduled probes, five consecutive observed failures, one durable logical outage and recovery notice, lease-fenced state/outbox writes, bounded retries and terminal retention. Separate application and monitor databases avoid coupling detection to the failing database. No platform-independent availability or exactly-once mail claim.

Evidence at implementation checkpoint: Rust 1.99.1 Wasm-target compile passes, Python source compilation passes, OpenTofu formatting passes. Pinned worker-build 0.8.7 release packaging also passes (actual Wasm plus JavaScript shim). Runtime fault/SQL behavior, migration application, Terraform provider validation, actual sending, inbox receipt and live monitoring activation remain pending final acceptance. No credentials or remote resources were accessed by the implementation agent.

Cloudflare Health Checks are paid, so none was enabled. Official Email Service documentation permits free sending to verified destinations; existing inbound verification does not prove outbound delivery. Both monitoring root switches must stay false until primary obtains that evidence. See `backend/watchdog/README.md` for exact deployment and activation order and platform-wide outage limitations.
