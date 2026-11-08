# Native avatar/backend integration

November 7, 2026. Implementation integration against backend 943c358 and the
subsequent approved owner-only pending-avatar contract amendment.

The native client previously discarded the upload receipt ID and used a new operation
for each retry. It now persists a device-only owner-scoped digest/operation/receipt in
the existing competition Keychain namespace. Same-owner/same-bytes retry retains its
operation and obtains a fresh assertion. Original photo bytes remain local in memory;
no pending original is fetched from a public URL.

Profile decodes optional `pending_avatar_id` in owner responses. This permits status
checks and cancellation after response loss/relaunch without needing original upload
bytes. Removing a photo removes both pending and previously approved owned variants,
using durable per-avatar removal operations and validating completion. The UI no
longer interprets “no approved avatar ID” as successful removal of a pending upload.

While Profile is active and moderation remains pending, it refreshes owner state at
15-second intervals. A status transition restarts/ends that task; backgrounding stops
it. Failed refresh offers Retry. Approved display uses authenticated approved derivative
bytes, while any pending preview remains private. Late controller responses check the
competition identity revision before changing presentation. Session clearing removes
avatar retry metadata with the existing account credential cleanup.

Preferences still send `{operation_id,preferences}` and decode `{preferences}` before
local persistence; push endpoints decode registered booleans. Hidden participants use
GET blocks signed cursor/snapshot pages and restart on 409. These shapes match the
backend; no additional adapter changes were needed for them. Backend avatar/APNs
deployment gates remain authoritative and unavailable responses remain errors.

Compilation/localization checks cover source integration only. Real App Attest upload,
moderation decisions, response-loss/account races, avatar purge completion, native
photo/crop/status rendering and notification delivery remain final-pass acceptance.
