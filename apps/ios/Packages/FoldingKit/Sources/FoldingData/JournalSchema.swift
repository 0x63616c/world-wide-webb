import Foundation

extension SQLiteConnection {
  func migrate() throws {
    try transaction {
      let version = try rows("PRAGMA user_version").first?["user_version"]
      guard version == "0" || version == "1" || version == "2" || version == "3" else {
        throw StoreError.incompatibleSchema
      }
      if version == "0" { for statement in Self.schema { try execute(statement) } }
      if version == "0" || version == "1" {
        try execute("ALTER TABLE work_outbox ADD COLUMN lease_token TEXT")
      }
      if version != "3" {
        try execute(
          "CREATE TABLE sync_checkpoints (store_id TEXT PRIMARY KEY, token TEXT NOT NULL)")
        try execute(
          "CREATE TABLE quarantines (entity_id TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(entity_id,payload_hash))"
        )
        try execute(
          "CREATE TABLE deferred_imports (payload_hash TEXT PRIMARY KEY, payload_json TEXT NOT NULL)"
        )
        try execute("CREATE TABLE rejected_reset_ids (reset_id TEXT PRIMARY KEY)")
        try execute("PRAGMA user_version=3")
      }
    }
  }

  private static let schema = [
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    """
    CREATE TABLE source_state (
      device_id TEXT PRIMARY KEY,
      next_sequence INTEGER NOT NULL CHECK(next_sequence BETWEEN 1 AND 9007199254740991)
    )
    """,
    """
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
      generation_revision INTEGER NOT NULL CHECK(generation_revision BETWEEN 0 AND 9007199254740991),
      generation_id TEXT NOT NULL, observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms BETWEEN 0 AND 9007199254740991),
      timezone_id TEXT NOT NULL, transition TEXT NOT NULL CHECK(transition IN ('open','close')),
      is_test INTEGER NOT NULL CHECK(is_test IN (0,1)), competition_epoch_id TEXT,
      payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, UNIQUE(device_id, sequence)
    )
    """,
    "CREATE INDEX events_generation ON events(generation_revision, generation_id, device_id, sequence)",
    """
    CREATE TABLE reset_markers (
      reset_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991)
    )
    """,
    """
    CREATE TABLE work_outbox (
      work_id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_ms INTEGER NOT NULL DEFAULT 0, lease_until_ms INTEGER,
      UNIQUE(kind, entity_id)
    )
    """,
    """
    CREATE TABLE setup_attempt (
      attempt_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      expected_transition TEXT NOT NULL, baseline_sequence INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL, consumed_event_id TEXT, status TEXT NOT NULL
    )
    """,
    "CREATE UNIQUE INDEX one_waiting_attempt ON setup_attempt(device_id) WHERE status='waiting'",
    """
    CREATE TABLE interruptions (
      interruption_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      after_sequence INTEGER NOT NULL CHECK(after_sequence BETWEEN 0 AND 9007199254740991),
      payload_json TEXT NOT NULL
    )
    """,
  ]
}
