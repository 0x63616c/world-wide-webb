# Homelab source handover

Status: historical. Source authority and `deploy/homelab` promotion now run from this
repository; do not treat this runbook as a live enablement checklist. Preserve existing host
identities, approved journals, keys, databases/media and Serve routes when operating hosts.

## Source and transaction contract

Authoring stays on main. Comin watches `deploy/homelab`, which points directly at a checked source
commit. `control/homelab` is a separate append-only decision journal containing only `state.json`:
current deployed source/CI receipt, one enrollment lease and the latest pending checked intent.
It contains no credentials, private host state or generated Nix configuration.

The publisher requires the exact successful Homelab CI run and attempt, own-repository main source,
named successful operations/Linux/Darwin/aggregate jobs, selected host delivery inputs and their
committed hash. The immutable source must declare schema3 and the WWW/deploy-homelab authority.
A manual reconciliation explicitly identifies successful exact-source CI; it is not a check bypass.
App-only CI completions exit without promotion. Scheduled recovery revalidates saved pending evidence.

The Git transaction atomically updates control and deployment refs with expected-old identities.
Deployment must advance within authoring history; an older finishing run cannot rewind deployment
or bypass a newer pending intent. Journal and deployment readback must agree. Lost successful push
responses are reconciled by exact remote identity. A mismatch or unavailable observation fails closed.
Workflow concurrency is intentionally absent: GitHub can replace pending workflow runs even when
cancellation is disabled. The journal CAS serializes cooperative writers instead.

There are no GitHub branch protections, by the owner's explicit choice. A direct push can bypass
normal automation. An unjournaled deployment change stops further automated work for recovery.
Never repair that mismatch by discarding the journal or forcing an older source over a newer host.

## Enrollment coordination

The Python transaction primitive binds a lease to the attempt ID, host and exact deployed source.
Acquire retries retain the original deadline. Renew/activate require the same binding and a live
lease; the maximum requested interval is two hours. A superseded candidate must revalidate before
activation. Checked newer sources coalesce into a durable pending intent while the hold is active;
the CI job exits rather than occupying a runner until enrollment finishes.

An expired prepared hold may be cleared by forward promotion: activation was never claimed, and
the old client must reacquire against the still-current source. An expired activation hold remains
fenced until explicit exact-source host recovery. Expiry is not evidence that installation stopped.
Release never promotes pending source on its own; its CI evidence must be revalidated first.

The lease primitive itself is not proof of host success. CLI acquire/renew/activate/release wiring,
exact-source host observation before release, approved-state rebind and scoped Git-key transfer
remain to be implemented and verified. In particular, do not call low-level `recover-release`
merely because its deadline elapsed. Keep production delivery disabled until these gates are met.

## Agent execution gates

1. Refresh original repos and preserve newer committed/dirty app and CLI changes. Complete local
   implementation and independent integrated review before publishing migration source.
2. Make WWW private, publish the reviewed candidate, pass CI and merge. No Pro upgrade is required.
3. Prove the destination host Git identity can read the exact source and deployment/control refs.
   Retain the original identity and recovery route until the replacement works.
4. Seed the source/journal through the checked promoter. Verify atomic Git support against GitHub
   with an isolated transaction before enabling automatic production promotion.
5. Rebind operator profiles without rewriting or deleting historical approved receipts, keys or
   in-flight state. Prove interrupted/resumed enrollment with a lease and source supersession.
6. Activate hosts through their existing stateful hold/drain/backup mechanisms. An activation must
   not wait for a runner job that is itself waiting for activation. Observe from outside that guest.
7. Read back installed repository/branch/revision, Comin/system/boot profile, service health and
   single-worker ownership. Verify retained data/media and fresh recovery evidence.
8. Release the verified lease and request immediate pending-intent reconciliation; the schedule
   is a fallback, not the intended half-hour delay in the normal agent-driven handover.
9. Enable the new automatic writer only after these proofs. Retire the old authority after proven
   delivery/recovery; preserve old repos or archives needed by historical recovery.
