# Backend deployment inventory

Implementation checkpoint, not production acceptance. Deploy the exact committed Worker only after
applying its committed migrations through **0017** with the checksum wrapper. Existing migrations are
immutable. The primary agent alone provisions credentials, deploys and enables acceptance gates.

## Runtime bindings

- `DB`: environment-specific D1 with migrations0001–0017.
- `AVATARS`: private environment-specific R2, no public bucket URL.
- `JOBS`: producer and this Worker's queue consumer. Start with batch size1, batch timeout5seconds,
  retries12, retry delay30seconds, concurrency2. D1 leases/retry records remain authoritative.
- `JOBS_DEAD`: producer/dead-letter destination; do not attach the ordinary consumer to it.
- `ADMIN_EMAIL`: optional send-email binding; unused while its explicit gate is false.
- One Cron, `*/5 * * * *`, invokes the scheduled outbox dispatcher. Queue categories include finalization,
  corrections, awards, avatar cleanup/alerts, account/recovery revocation, retention and monitoring.

## Non-secret configuration

- `DEPLOYMENT`: `production` only; other environments are rejected.
- `WORKER_VERSION`: exact deployment identity, also returned by health/capabilities and logged.
- `AUTH_ENCRYPTION_KEY_VERSION`, `AUTH_SUBJECT_HMAC_KEY_VERSION`: current key-ring versions, initially`v1`.
- `APPLE_SIGN_IN_CLIENT_ID`, `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`.
- `APP_ATTEST_APP_ID`: team.bundle; `APP_ATTEST_ENVIRONMENT`: development or production;
  `APP_ATTEST_BUNDLE_VERSIONS`: explicit JSON allowlist. Production refuses development App Attest.
- `ADMIN_ORIGIN`: canonical HTTPS origin; `ACCESS_TEAM_DOMAIN`: exact team HTTPS issuer without trailing
  slash; `ACCESS_AUDIENCE`; `ADMIN_EMAIL_ALLOWLIST`: explicit JSON array.
- `APNS_TOPIC`: exact bundle ID; `APNS_ENVIRONMENT`: sandbox or production; `APNS_KEY_ID`, `APNS_TEAM_ID`.
  Production refuses sandbox APNs.
- `VERIFIED_CAPABILITIES`: default`[]`. Populate only with final accepted names; never use compilation
  evidence to advertise shipping readiness.
- `AVATAR_UPLOADS_ENABLED=false`, `APNS_ENABLED=false`, `ADMIN_EMAIL_ENABLED=false` until their respective
  acceptance/verification. Optional `ADMIN_ALERT_FROM` and `ADMIN_ALERT_TO` require verified outbound
  sender/recipient capability; inbound support forwarding does not establish that.

## Secret binding names and formats

No values belong in Git, command literals, logs or agent messages.

- `AUTH_ENCRYPTION_KEYS`: JSON version→base64url32-byte AES key.
- `AUTH_SUBJECT_HMAC_KEYS`: JSON version→base64url32-byte subject HMAC key.
- `AUTH_NETWORK_HMAC_KEY`: base64url32-byte key.
- `APPLE_SIGN_IN_PRIVATE_KEY_PKCS8`: base64url PKCS8 DER, not raw PEM.
- `APNS_PRIVATE_KEY_PKCS8`: base64url PKCS8 DER, not raw PEM.
- `APNS_TOKEN_HMAC_KEY`: separate stable base64url32-byte installation indexing key. Rotation requires
  coordinated token-index migration or complete re-registration; replacing it silently breaks uniqueness.

## Implemented surface

Apple sign-in/refresh/logout/reauthentication/deletion recovery; App Attest enrollment/assertions;
join/transfer/events/receipts/reset/leave/delete; live and frozen boards/private historical results/share;
profile moderation/report/block; private custom avatars and Access moderation; notification preferences,
installation ownership and APNs award delivery; queued privacy cleanup, period snapshots and explicit
previewed corrections; Access/CSRF/revision-fenced administration, operational switches, case retention,
annual ban reviews, failed-job retry controls, safe logs and operational indicators.

`GET /v1/health` is a two-second bounded indexed D1 probe with status/version only. It does not assert
feature acceptance. External health/DLQ monitoring and notification-channel wiring remain infrastructure
work. `/admin/config` shows ingestion/finalization/failed-job indicators; `/admin/jobs` handles audited
retries including paused external categories. Pauses preserve personal tracking and pending work.

## Remaining acceptance, not passed

- Full pinned local formatter/clippy/unit/workerd/D1 suite at final validation; latest batches have actual
  Wasm/native compilation and schema/SQL preparation evidence only.
- Official/current Apple and device App Attest flows, SIWA exchange/revocation/recovery, key rotation,
  real Access alternate-host/CSRF controls and token replay/concurrency tests.
- Actual Queue delivery/retries/dead-letter and R2 create-only/tombstone races, image memory/decoder stress,
  deletion cleanup and external retry/resume behavior.
- Frozen/corrected result privacy interleavings, ties/cursors, cutoff boundaries and measured D1 limits for
  one-batch snapshot/publication. Current accepted-history replay/live ranking can load a full relevant
  stream/roster; realistic scale testing may require further implementation before acceptance.
- Live APNs transport/authorization/error classification, token rotation/ownership and notification display;
  outbound admin email only if sender capability is verified. Localized notification wording needs review.
- Admin browser review, moderation vocabulary/localization review, retention/annual-review clock tests,
  safe-log redaction and operational alert simulations.
- Independent final security/UI reviews and physical-device checks remain tracked by primary. Device
  checks are deferred to F13 after submission, never marked passed.

No live deployment, credential access, email, push, moderation action or production correction was
performed by the backend implementation agent. See `docs/experiments/backend-runtime.md` for checkpoints.

## Reviewed readiness overlay

`generate-worker-config.py --readiness path/to/readiness.json` preserves reviewed feature readiness across regeneration. Without this option all three feature gates remain false and capabilities empty. Store the overlay with deployment evidence in the repo; never include secrets.

Required fields: `environment`, exact `worker_version`, `bindings_sha256` (SHA-256 of the OpenTofu bindings serialized with sorted keys and compact JSON separators), `reviewer`, ISO-8601 `reviewed_at`, `capabilities`, `features`, and `evidence`. Features explicitly map `APNS_ENABLED`, `AVATAR_UPLOADS_ENABLED`, `ADMIN_EMAIL_ENABLED` to booleans. Evidence maps each capability and enabled feature to `{path, sha256}`; paths must stay inside the overlay directory. A changed commit/binding/evidence hash fails before replacing generated output. Promotion remains a reviewed acceptance decision; the generator never invents evidence. See `scripts/test-worker-readiness.py` for a synthetic example and regression coverage.

`./scripts/check-backend` rebuilds the pinned Wasm artifact before local workerd tests. Host-only Cargo tests cannot exercise Worker bindings. Quarantine approval checks current membership/restriction/generation, original enrollment/device/cutoff, setup exclusion and time ordering; closed awards change only through the existing audited correction flow.
