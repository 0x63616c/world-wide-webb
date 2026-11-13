# Synchronization

Providers own lifecycle and presentation state; PanelKit owns transport and shared synchronization primitives.
Keep independent features from blocking one another, cancel work when inactive, retain last-known state on
transient failures and avoid bursts after delayed polls. Device mutations need explicit intent ownership and
idempotency rather than transport retries. Authoritative timestamps come from Rust; use request midpoint
sampling for clock offsets. Existing tests cover cancellation, backoff, stale responses and concurrent clients.
