# Sync detail and hidden participants

November 7, 2026. Implementation and generic simulator compilation complete.

Settings → Sync is an on-demand native Form. It reads actual CloudKit account
availability or local-only mode, remembers a failed private sync pass, and reports
journal-backed public pending-fold/reset state separately. “Available” means account
access; it never claims remote CloudKit convergence. “Check now” runs the existing
sync/upload path. A failure retains a recoverable error state. Account invalidation
clears the presentation, and disappearing views discard late responses.

Profile → Hidden participants loads GET `/v1/blocks`, so participants can be shown
again after relaunch. The native list uses existing safe names when available and a
generic Participant fallback otherwise; IDs are not displayed. Server pages retain
opaque cursors/snapshot versions. Mutation invalidates pending list loads; snapshot
changes restart the listing. Unhide commits on the backend before removing a row.
Unavailable endpoints produce retry rather than a successful empty-list claim.

App/widget Debug simulator compilation passed in `/tmp/folding-sync-blocks-build.log`.
Localization validation passed: 214 semantic keys × ten launch locales. Backend
implementation was coordinated; live API/account/CloudKit behavior, race regressions,
large list rendering and native accessibility remain final-pass acceptance work.
