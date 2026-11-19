-- Every accepted wall-switch edge, so gesture timing can be tuned from Settings. Pruned after 30 days.
CREATE TABLE switch_flip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    switch_id TEXT NOT NULL,
    state TEXT NOT NULL,
    changed_at_utc TEXT NOT NULL,
    gap_ms INTEGER,
    gesture TEXT NOT NULL,
    action TEXT NOT NULL
);
CREATE INDEX switch_flip_changed ON switch_flip(changed_at_utc);
