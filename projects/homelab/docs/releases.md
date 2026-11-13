# Application releases and deployment ownership

Source consolidation is complete: both Macs and CLI delivery use WWW. Old-repository links
below are historical observations. See the [migration record](../../../docs/plans/monorepo-migration-progress.md)
for current ownership; inspect live host state before operations.

Control Center source is in `projects/control-center`; homelab owns the mini's service runtime,
shared backups, host updates and private networking. The consolidation's live acceptance is
tracked in [the migration progress](../../../docs/plans/monorepo-migration-progress.md).

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
python3 projects/homelab/scripts/promote-control-center.py \
  --manifest projects/homelab/services/control-center/release.json \
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

The local `Promote Control Center image` candidate replaces the old SSH-copy deployment in
`deploy-mini.yml`. It consumes the successful trusted-main CI image receipt, then commits only
`projects/homelab/services/control-center/release.json`. This uses a dedicated repository-scoped
`CONTROL_CENTER_PROMOTION_DEPLOY_KEY`, so the Git push can start normal main CI. A workflow-token
push would suppress that trigger. Prove the scoped-key push/CI canary before enabling the writer;
keep its key in the approved recovery store and out of ordinary build guests.

The pin commit records the exact image source/digest and CI run/attempt provenance. It preserves
concurrent authoring changes, rejects older/divergent sources and changed bytes for an already
pinned source, and reconciles lost push responses by reading Git back. Retries do not create a
second pin commit. It reports a pin publication, never a completed deployment.

The normal main Homelab CI and `deploy/homelab` promoter then verify/publish the resulting desired
state. The installed updater's existing stateful generation transaction owns its backup, runtime
reconcile and health gate. This preserves one image pin and one host activation owner; no app
workflow copies Compose, backup scripts, launchd definitions or Serve configuration onto the mini.
There is no temporary runtime override that a later host update could accidentally undo.

`CONTROL_CENTER_IMAGE_DELIVERY_ENABLED`, `CONTROL_CENTER_PROMOTION_ENABLED` and
`HOMELAB_DELIVERY_ENABLED` must be enabled only after their source/host canaries. The old
`MINI_DEPLOY_ENABLED` flag no longer enables this replacement. Source-authority handover remains
necessary before the mini can consume the new pin. Preserve old release generation records;
the new epoch uses the existing forward Git promotion and serialized Nix system generations,
not the old workflow run number. Delayed old pipelines must remain disabled.

Cloudflare continues to use the scoped operations SSH route; app image publication no longer
needs that route. The controller therefore does not grant operations capacity to `deploy-mini.yml`.
The local candidate and its Git race/retry tests do not prove a live deployment, scoped-key event
trigger, unchanged backup ownership or restore. Those acceptance steps remain outstanding.

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
