# Backend runtime foundation evidence

Date: November 7, 2026. Local development evidence only; no staging or production resources were accessed by the backend agent. CI is owner-deferred. Physical-device tests remain deferred to F13.

## Toolchain and dependencies

- Rust 1.99.1 (`58cf8f9c3`, installed exact toolchain), `wasm32-unknown-unknown`.
- workers-rs / worker-build 0.8.7; wasm-bindgen 0.2.129, js-sys/web-sys0.3.106.
- Serde1.0.229 / serde_json1.0.154, chrono-tz0.10.4, SHA-2 0.11.1.
- P-256 0.14.0 (pure Rust, no default OS randomness dependency), Ciborium0.2.2, serde_bytes0.11.19.
- Image0.25.10 with only JPEG/PNG; Askama0.16.1 with derive/std; rusqlite0.41.1 only in native tests.
- Node26.13.0 / Miniflare5.20261104.0-beta, the dependency used by current Wrangler4.158.0. The initial stable Miniflare4.20260730.0 had three high-severity audit findings through sharp/undici; the replacement lockfile reports zero. No override or audit suppression was used.

Exact Cargo/npm lockfiles are committed under `backend/`. Rust and Worker packaging are local tool pins, not proof of deployed Cloudflare compatibility.

## Checks and observations

`backend/scripts/check` runs formatting, warning-denying Clippy for native/all targets and Wasm, native tests, the actual Worker packager, npm clean install and local workerd tests. The batch passed 12 native tests (including shared fixture loops) and 2 local workerd/D1 tests; both Clippy targets and actual packaging passed. Subsequent additions to eligibility/tied-population coverage passed the same native Clippy/test checks.

- All eleven shared reducer cases pass in original and reversed arrival order. Shared competition fixtures cover ties, rank/medal skipping, twenty-participant percentile values, reset ordering and exclusive cutoff.
- Negative envelopes cover unknown fields, missing nullable epoch, uppercase UUIDs, unknown timezone, unsafe sequence and changed event/sequence identities.
- Synthetic P-256 assertions verify exact-body binding; changed body, RP ID, old counter and trailing CBOR fail. A separately generated Apple CryptoKit synthetic signature confirms ECDSA-with-SHA256 over the derived nonce. It is **not** an official App Attest attestation/device vector. The nonce is the message supplied to ECDSA-with-SHA256; passing it as a prehashed digest is the wrong protocol.
- Native JPEG/PNG re-encoding/dimension/input tests pass; Askama escapes nickname and attribute content. Both libraries compile into the actual Wasm target. Image worst-case CPU/memory on deployed Workers remains unmeasured.
- The compiled Rust Worker runs in local workerd and rejects forged bearer input without enabling any public mutation. An oversized body returns413; admin on the API route returns404.
- The same guard SQL runs against local workerd's D1 binding. A deliberately failed later receipt insert rolls back the guard, challenge consumption, key counter, receipt and job. Two competing batches with the same participant revision produce exactly one committed receipt/job/revision; the losing guard raises a constraint error. This is local D1 evidence, not a remote D1 integration pass.
- Initial packaging failed because `strip = true` removed the Wasm feature section. Changing only to `strip = "debuginfo"` retained it and the actual worker-build package succeeded. No runtime/signature check was weakened.

## Outstanding gates

F03 remains open: Apple JWT signature/audience/nonce/code exchange; full App Attest chain/nonce extension/key-ID/environment enrollment and official/device vectors; opaque token rotation/reuse/reauth/deletion flow; durable authorized receipt/idempotency/recompute operations; remote D1 rollback/CAS; avatar stress/moderation/R2; and real APNs HTTP/2 request/response validation. None of these may be inferred from local crypto or SQL tests.

The production Worker currently exposes no success operation and must not be presented as a ready backend. New route contracts and schema ownership remain coordinated with the primary agent. Staging deployment and credentials are primary-agent-only work.

## References

- [workers-rs0.8.7](https://docs.rs/worker/0.8.7/worker/) and [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- [Apple server validation procedure](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).
- [RustCrypto P-256](https://docs.rs/p256/0.14.0/p256/) and [image decoder limits](https://docs.rs/image/0.25.10/image/struct.Limits.html).
- [workers-rs issue1014: full stripping breaks externref](https://github.com/cloudflare/workers-rs/issues/1014).
- [Independent Ruby/OpenSSL assertion implementation](https://github.com/catawiki/devicecheck-ruby/blob/main/lib/devicecheck/assertion.rb) checked for the nonce/signature API semantics; production code uses RustCrypto/Ciborium and no copied implementation.
