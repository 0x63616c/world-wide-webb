# Widgets and notification presentation implementation

November 7, 2026. Implementation-first batch; final simulator/device review remains pending.

Four native App Intent widget kinds constrain configuration to each supported
family: small and rectangular offer folds/time unfolded/daily limit, medium also
offers the seven-day trend, and circular offers folds/daily limit only. Each
instance owns its selected metric. Circular fold counts do not imply a daily-limit
gauge. Progress caps visually at 100% without capping the displayed count.

The extension reads a protected atomic App Group snapshot through FoldingData;
it never records events, reconciles CloudKit, or calls the leaderboard. Missing
configuration/data displays Open Folding, never sample totals. Gallery placeholder
data is isolated to the placeholder provider. Snapshots carry routing/generation
identity, data time, home-day expiry, theme preferences, and immutable statistics.
The composition root owns account/reset fencing and publication. The timeline
invalidates yesterday's values at the home-day boundary. Duration is a snapshot
value; no unverified live-timer claim is made.

`FOLDING_APP_GROUP_IDENTIFIER` supplies the environment-specific group through
Info.plist. Its empty default deliberately provides no data. Production App Group
entitlements/signing and publication fencing must be integrated before release.
Widget colors honor system rendering modes; app appearance overrides do not
force a Lock Screen theme. Taps use existing allowlisted Today/History URLs.

Settings exposes separate daily-limit, weekly, and monthly choices, initially off.
The injected save handler returns the actual persisted/permission-adjusted values.
Denied authorization exposes a Settings link. The presentation itself neither
prompts on launch nor claims backend result notifications have been enabled.

The shared string catalog includes widget configuration and notification copy in
all ten launch locales. Native-speaker validation, widget gallery installation,
all family/theme/accessibility renders, permission flows, account/reset races,
and notification delivery are final-pass acceptance work, not claimed here.
