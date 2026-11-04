# Application releases and deployment ownership

The app stays in `world-wide-webb`. Homelab will own the machines, runtime,
service placement and deployed image revisions after cutover. The current
`world-wide-webb` deployer remains the live owner; nothing in this PR changes it.

## Cloudflare boundary

Homelab takes ownership of the `cloudflared` process on the selected Mac, its
pinned container image, startup/reconciliation, and host-scoped tunnel token.
The application source and image build remain in `world-wide-webb`.

Cloudflare account resources for `worldwidewebb.co` are outside this initial
ownership transfer: DNS records, tunnel hostname/origin routes and Access
policies retain their existing management path. This is a scope decision, not
a claim that all those resources are currently declared in the app repository.
Preserve and verify their existing configuration at service cutover; do not
create a second tunnel or silently change routes as part of host bootstrap.

A later, separately reviewed infrastructure change can assign one declarative
owner to Cloudflare account configuration. Moving the tunnel process does not
by itself move account-wide DNS or Access management into this repository.

`services/control-center/release.json` records the observed live app digest,
its OCI source-revision label and the PostgreSQL digest. The reconciler reads
these Git-tracked values and overrides `WWW_IMAGE`/`POSTGRES_IMAGE` from any
ambient or encrypted Compose settings. Image identity belongs in a reviewable
release diff, not inside a secret document.

Initial values were read from the running mini on 2026-11-03:

- app digest `sha256:7c039963a2d94132d2cae54e5000f24fb1dceb683a685cc7e109ef5bb224afe8`;
- source label `38afee6c84fcf48c0edb2466aa4b27d287a59c30`;
- PostgreSQL digest `sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81`;
- production `WORKER_CYCLES=on`, HA origin `http://192.168.0.130:8123`.

This is observed provenance, not independent verification of build attestations.
Worker cycles must remain off during isolated restore testing and switch on only
when production ownership transfers. Do not run two production worker copies.

## Promotion flow

1. `world-wide-webb` tests and builds a revision, publishes its immutable image,
   and retains the source SHA and image digest as release evidence.
2. A promotion proposes a change here to `release.json`. The local preparation
   helper edits only the app image and source SHA:

   ```sh
   python3 scripts/promote-control-center.py \
     --source-revision REVIEWED_40_CHARACTER_COMMIT \
     --image ghcr.io/0x63616c/www-control-center-mini@sha256:REVIEWED_64_CHARACTER_DIGEST
   ```

   It rejects mutable tags and foreign repositories and leaves PostgreSQL alone.
   It does not push, open a PR, merge or deploy, and it does not yet verify source
   CI or registry attestations. Those checks must precede accepting a promotion.
3. Homelab PR CI validates the manifest and builds both hosts. Review the app's
   migration compatibility and recovery evidence before merge.
4. After migration and updater readiness, successful exact-commit `main` CI will
   make that configuration eligible for the ten-minute host pull loop. The current
   updater remains disabled; a merge today does not deploy any machine.
5. The deployment transaction must take the operation lock, create a consistent
   pre-release backup, apply the image, verify health/source SHA/worker ownership,
   and record success. An incompatible database migration requires data recovery;
   switching the Nix generation alone is insufficient.

## One owner at cutover

Pause `world-wide-webb`'s mini deployment workflow and its local deploy mechanism,
wait for any in-flight release, verify no queued release can resume, then transfer
service ownership to homelab. Keep the old app repo's build/test/image publishing
workflow. Record the disabled owner and first successful homelab deployment in
the cutover evidence. Reverting ownership requires the same explicit handoff.
Do not enable both deployment paths as a fallback.

Automatic cross-repository promotion PR creation, source CI/attestation checks,
pre-release snapshot enforcement and application-aware rollback are still to be
implemented. No app-repository workflow has been modified in this task.
