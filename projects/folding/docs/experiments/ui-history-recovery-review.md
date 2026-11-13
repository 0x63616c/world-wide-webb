# Private-history recovery UI

November 7, 2026. This batch adds a conditional Settings → Data warning when
`PrivateHistoryHealth.requiresAttention` is true. The destination explains only
that some synced history could not be verified, and offers export, the existing
reset confirmation, and support. No record identifiers or diagnostic counters
appear in product copy.

Recovery and ordinary Settings reuse the same export-ticket workflow and reset
confirmation. Both reset entries are disabled when `canResetHistory` is false;
the model rechecks that condition when the confirmation action executes. The
store remains authoritative for revision exhaustion and reset safety. Export and
support stay available when resetting is impossible. Reset does not claim to undo
rejected tombstones.

All ten launch languages include the two new semantic strings. AI translations
still require native-speaker review. The compiled native catalog contains 137
keys across ten locales.

Focused native presentation coverage includes refusing a reset after health
becomes non-resettable, then permitting it after an authoritative health update.
The complete focused suite has 15 tests. Actual-corruption diagnostics and reset
revision behavior belong to the data/runtime integration tests.

Native recovery-screen renders and interaction with its shared export/reset
presentations are pending: another task was changing Device Hub selection during
the preceding review, so this batch does not claim visual acceptance. No corrupted
data was injected into the user's account or normal simulator journal.
