# Application releases and deployment ownership

Control Center source is in `projects/control-center`. Homelab owns the Mini's service runtime,
shared backups, host updates and private networking. The Mini's assigned services are listed in
`homelab.json`; see [current state](current-state.md).

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

## Image promotion

The `Promote Control Center image` workflow (`.github/workflows/deploy-mini.yml`) runs after a
successful main CI push. It consumes that run's tested image receipt and changes only
`projects/homelab/services/control-center/release.json`. It uses the dedicated repository-scoped
`CONTROL_CENTER_PROMOTION_DEPLOY_KEY`, so the resulting push starts normal CI; a workflow-token
push would suppress that trigger. Keep the key in the approved recovery store and out of ordinary
build guests.

The pin commit records the exact image source/digest and CI run/attempt provenance. It preserves
concurrent authoring changes, rejects older/divergent sources and changed bytes for an already
pinned source, and reconciles lost push responses by reading Git back. Retries do not create a
second pin commit. It reports a pin publication, never a completed deployment.

The normal main Homelab CI and `deploy/homelab` promoter then verify/publish the resulting desired
state. The installed updater's existing stateful generation transaction owns its backup, runtime
reconcile and health gate. This preserves one image pin and one host activation owner; no app
workflow copies Compose, backup scripts, launchd definitions or Serve configuration onto the mini.
There is no temporary runtime override that a later host update could accidentally undo.

Cloudflare continues to use the scoped operations SSH route; app image publication does not
need that route.

For a release, consume the successful trusted-main immutable image rather than rebuilding it.
A pin commit is not a deployment: check the installed revision and the live image digest on the
Mini. Rollback changes the authorized artifact/configuration; it does not rewind user data.

## Cloudflare boundary

Homelab owns the cloudflared process and its runtime credentials. Account resources live under
`infra/cloudflare`; they need a single imported state owner before new automatic applies.
Moving repository files or the tunnel process does not transfer DNS/Access/state authority.
Preserve unrelated services and routes. New hosted app backends default to Cloudflare; this
does not rewrite Control Center's home-local Rust/SQLite service or Folding's Rust Worker.
