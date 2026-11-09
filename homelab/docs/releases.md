# Application releases and deployment ownership

Control Center source is in `apps/control-center`; homelab owns the mini's service runtime,
shared backups, host updates and private networking. The consolidation's live acceptance is
tracked in [the migration progress](../../docs/plans/monorepo-migration-progress.md).

On November 8, 2026, read-only inspection found the mini running homelab revision
`ad34038b10f432530ade78f844a88fa49bcd0c9a` from the original `0x63616c/homelab` authority.
Its assigned services include Control Center, Bambuddy, Hindsight, cloudflared, Penpot, Beszel
and Home Assistant, with backups configured. The private app health endpoint reported native
SQLite app revision `72f9533c84cc9362b9a3df9a5fe3f079411c638d`, healthy with worker cycles enabled.
These are point-in-time observations, not proof of a new WWW deployment or backup restore.

## Current implementation

`services/control-center/release.json` records an immutable app digest, source revision,
approved source repository and SQLite engine. `scripts/promote-control-center.py` validates
and edits that manifest locally. The reconciler uses this pin, overriding ambient image values;
there is no PostgreSQL sidecar in the maintained Control Center Compose definition.

The local helper does not publish, merge, verify provider CI or deploy:

```sh
python3 homelab/scripts/promote-control-center.py \
  --manifest homelab/services/control-center/release.json \
  --source-revision REVIEWED_40_CHARACTER_COMMIT \
  --image ghcr.io/0x63616c/www-control-center-mini@sha256:REVIEWED_64_CHARACTER_DIGEST
```

The host-wide `homelab-operation` lock serializes stateful work. Transactional generation
activation creates a consistent pre-change backup, changes the system generation, reconciles
assigned services and verifies health. Interrupted transactions remain for explicit recovery;
never delete their markers to force progress or restore an older database over newer data.
The shared backup implementation and launchd schedules belong to homelab. App releases must
not reinstall or overwrite them.

## Consolidation handover still to prove

The reviewed source includes exact-CI `deploy/homelab` promotion and a private CLI distribution
candidate. These are not evidence that either host now consumes WWW. Preserve the original
source/update authority until the replacement's exact revision, saved-profile/reboot/recovery
and scoped Git access pass acceptance.

The old `Deploy Mac mini` workflow is held off and still targets the retired user/runtime.
Do not re-enable it. Its image/source checks can be reused, but deployment must use the installed
homelab runtime, lock, backups, single worker and private Serve ownership. The local operations
profile/canary is also held off pending actual network policy and transport acceptance.
Durable image/source ordering and rejection of delayed old authorities remain required before
activating app delivery. A zero-exit stale-release skip is not delivery evidence.

For a release, consume the successful trusted-main immutable image rather than rebuilding it.
Prove the live digest/source, retained integrations and SQLite/media, unchanged shared backup
ownership, a fresh NAS restore and exactly one production worker. Keep old release/recovery
material until that acceptance exists. Rollback changes the authorized artifact/configuration;
it does not silently rewind user data.

## Cloudflare boundary

Homelab owns the cloudflared process and its runtime credentials. Account resources live under
`infra/cloudflare`; they need a single imported state owner before new automatic applies.
Moving repository files or the tunnel process does not transfer DNS/Access/state authority.
Preserve unrelated services and routes. New hosted app backends default to Cloudflare; this
does not rewrite Control Center's home-local Rust/SQLite service or Folding's Rust Worker.
