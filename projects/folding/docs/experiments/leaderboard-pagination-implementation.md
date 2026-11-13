# Live leaderboard pagination

November 7, 2026. Native implementation and generic simulator compilation complete.

The board requests server pages using opaque cursors. “More places” loads the next
page, with progress and retry states. First-page refresh and period changes fence
older requests; account/reset invalidation also invalidates pending page responses.
The app preserves canonical ranks, population and percentiles and removes duplicate
participant IDs without renumbering rows. Blocked rows remain presentation filters.

A changed snapshot or period discards accumulated pages and starts again. A cursor
HTTP 409 also restarts from the first page; other failures retain the current page
and expose retry. First-page failures never retry recursively. Both snapshot version
and period ID are opaque server values. The existing first-page injection remains
for deterministic screenshot fixtures; the live controller supplies the page loader.

App/widget Debug simulator compilation passed (`/tmp/folding-pagination-build.log`).
Localization validation passed: 205 semantic keys × ten locales. Final-pass checks
still cover live snapshot churn, delayed responses during period/account changes,
large boards, blocked canonical ranks, and native scrolling/accessibility rendering.
