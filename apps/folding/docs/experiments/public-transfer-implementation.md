# Public tracking phone transfer

November 7, 2026. Implemented; device/network acceptance remains final-pass work.

Settings displays the private selection and authenticated public enrollment separately.
“Use this iPhone” explicitly confirms that later uploads from the old public phone
will not count, alongside the existing private-history exclusion explanation.
The button remains available when private selection is already local but public
tracking is elsewhere. No device names are invented.

The private journal persists the participant, installation, reset generation, source
epoch, and separate transfer/reset operation IDs. Retry preserves the same transfer
body and obtains a fresh App Attest assertion. A newly observed competing epoch
requires a new explicit attempt; it never silently wins a concurrent server CAS.
The target epoch and private transfer marker commit together under the existing
partition/generation transaction fences. Marker watermarks capture known source
sequences at local commit. Account partition activation or installation replacement
clears pending public state; a private reset makes old pending work ineligible.

When local reset generation is greater, a separately identified `/resets` request
synchronizes it before transfer. When the server generation is greater, the app waits
for the immutable iCloud reset marker; it does not invent its timestamp. If `/me`
already confirms this installation after response loss, the durable explicit intent
can complete locally without sending another transfer. Revoked installations suspend
public upload state while retaining a pending explicit handover for reconciliation.

Combined Release simulator compilation passed with the real app composition.
Localization validation passed: 204 semantic keys × ten launch locales. Final-pass checks still include
server response loss, relaunch recovery, concurrent transfer/reset/account changes,
old-device upload cutoff, actual two-device iCloud propagation and native UI rendering.
