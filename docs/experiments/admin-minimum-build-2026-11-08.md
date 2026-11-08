# Admin-managed minimum build — November 8, 2026

Owner requested the admin panel as the sole control, replacing the deployment variable. #65 extends the shipped policy-aware app without requiring another app binary.

Operations exposes Minimum build (0 = off) in its existing guarded form. Migration 0020 adds the bounded integer to the singleton configuration with default 0. Existing Access/CSRF checks, revision CAS, idempotent operation IDs and before/after audit records cover changes. Policy and server retirement share a 60-second isolate cache; saving invalidates the handling isolate, and an in-flight pre-save read cannot repopulate its cache. Other isolates refresh within one minute. Policy failures do not extend expired values; recovery routes remain exempt. Generator output contains no environment override and rejects the obsolete input.

Local checks: 34 Rust tests, native/Wasm Clippy/format and compiled Wasm packaging pass. All 16 workerd/D1 tests pass, including protected admin rendering, malformed/negative/overflow input, missing/forged authorization, CSRF/origin rejection, stale revision, response-loss retry without duplicate audit, operation-payload conflict, activation and rollback. Cached hot requests still enforce the floor after the synthetic policy table is removed, demonstrating no per-request database read; a cold missing policy database fails closed. Database constraints reject invalid values. Configuration regression passes.

Local ignored evidence: `build/admin-minimum-check.log` (Rust/Wasm checks) and `build/admin-minimum-runtime.log` (final 16-test Worker/D1 pass), in the original workspace. Provider rollout is verified below. Keep the production minimum at 0; no user lockout is authorized by adding this control. Device acceptance remains #47/F13; no new TestFlight binary is needed.

## Live rollout

Merged [PR #66](https://github.com/0x63616c/folding/pull/66) as `27a925c1902b2cf42a4350b7c1ff1c75e40298f5`. Staging then production verified all **20 checksum migrations** and the exact Worker source in health. Cloudflare settings confirm the old environment binding is absent; every other resource/secret binding, compatibility/CPU/log settings, feature flag, allowed app build and operational control is preserved. Both public policies return minimum **0**.

- Staging version `0b603f80-ec90-42c9-a81e-c11dc2524733`. Through the actual Access-protected Operations form, changed minimum 0 → 12 (revision 2 → 3), verified public policy 12, build 11 rejected with HTTP 426 and build 12 reaching ordinary authentication (HTTP 401). Restored 0 (revision 4), observed both audit records and verified policy returned 0 after cache propagation. Other toggles stayed On.
- Production version `aa784a34-1d5f-40e6-8f8e-c5bcf7d6c563`. Authenticated production Operations visibly shows the new field at 0, revision still 0 and existing toggles On. No production minimum was activated.

Ignored release-checkout receipts are under `build/admin-minimum/`: settings/control baselines, generated deployment files, migration/deployment receipts, provider readbacks and `admin-ui-verified.json`. Existing TestFlight **0.1.11 (12)** uses this policy without another app upload. CI/storefront/submission and physical-device acceptance remain deferred; no broad feature-acceptance claim is made.
