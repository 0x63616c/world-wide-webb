import Foundation

extension SQLiteConnection {
  func migrate() throws {
    try transaction {
      let version = try rows("PRAGMA user_version").first?["user_version"]
      guard
        version == "0" || version == "1" || version == "2" || version == "3" || version == "4"
          || version == "5" || version == "6"
      else {
        throw StoreError.incompatibleSchema
      }
      if version == "0" { for statement in Self.schema { try execute(statement) } }
      if version == "0" || version == "1" {
        try execute("ALTER TABLE work_outbox ADD COLUMN lease_token TEXT")
      }
      if version != "3" && version != "4" && version != "5" && version != "6" && version != "6" {
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
      if version != "4" && version != "5" && version != "6" {
        try execute(
          "ALTER TABLE deferred_imports ADD COLUMN generation_revision INTEGER NOT NULL DEFAULT 0")
        try execute(
          "ALTER TABLE deferred_imports ADD COLUMN generation_id TEXT NOT NULL DEFAULT ''")
        var cursor = ""
        while true {
          let batch = try rows(
            "SELECT payload_hash,payload_json FROM deferred_imports WHERE payload_hash>? ORDER BY payload_hash LIMIT 500",
            [.text(cursor)])
          if batch.isEmpty { break }
          for row in batch {
            let record = try JSONDecoder().decode(
              MirrorRecord.self, from: Data(row["payload_json"]!.utf8))
            guard let generation = record.generation else { throw StoreError.invalidInput }
            try execute(
              "UPDATE deferred_imports SET generation_revision=?,generation_id=? WHERE payload_hash=?",
              [
                .integer(generation.revision),
                .text(generation.resetID.uuidString.lowercased()),
                .text(row["payload_hash"]!),
              ])
          }
          cursor = batch.last!["payload_hash"]!
        }
        try execute(
          "CREATE INDEX deferred_generation ON deferred_imports(generation_revision,generation_id)")
        try execute("CREATE INDEX deferred_reset ON deferred_imports(generation_id)")
        try execute("PRAGMA user_version=4")
      }
      if version != "5" && version != "6" {
        try execute(
          "CREATE TABLE transfer_markers (transfer_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), payload_json TEXT NOT NULL)"
        )
        try execute("CREATE TABLE rejected_transfer_ids (transfer_id TEXT PRIMARY KEY)")
        try execute(
          "CREATE TABLE known_source_sequences (device_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991))"
        )
        try execute(
          "INSERT INTO known_source_sequences SELECT device_id,MAX(sequence) FROM events GROUP BY device_id"
        )
        try execute(
          "INSERT INTO known_source_sequences SELECT device_id,next_sequence-1 FROM source_state WHERE 1 ON CONFLICT(device_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)"
        )
        try execute(
          "CREATE TRIGGER remember_source_sequence AFTER INSERT ON events BEGIN INSERT INTO known_source_sequences VALUES (NEW.device_id,NEW.sequence) ON CONFLICT(device_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence); END"
        )
        try execute("PRAGMA user_version=5")
      }
      if version != "6" {
        try execute(
          "CREATE TABLE IF NOT EXISTS derived_state (id INTEGER PRIMARY KEY CHECK(id=1), journal_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991), epoch INTEGER NOT NULL CHECK(epoch BETWEEN 0 AND 9007199254740991))"
        )
        try execute(
          "INSERT OR IGNORE INTO derived_state VALUES (1,?,0,0)",
          [.text(UUID().uuidString.lowercased())])
        try execute(
          "CREATE TABLE IF NOT EXISTS derived_changes (revision INTEGER PRIMARY KEY,event_id TEXT NOT NULL)"
        )
        try execute(
          "CREATE TRIGGER IF NOT EXISTS derived_event_append AFTER INSERT ON events BEGIN UPDATE derived_state SET revision=revision+1,epoch=epoch+CASE WHEN EXISTS(SELECT 1 FROM events WHERE device_id=NEW.device_id AND sequence>NEW.sequence) THEN 1 ELSE 0 END; INSERT INTO derived_changes SELECT revision,NEW.event_id FROM derived_state; DELETE FROM derived_changes WHERE revision<=(SELECT revision-2048 FROM derived_state); END"
        )
        for table in [
          "events", "interruptions", "reset_markers", "transfer_markers", "rejected_transfer_ids",
          "quarantines",
        ] {
          for operation in ["INSERT", "UPDATE", "DELETE"]
          where !(table == "events" && operation == "INSERT") {
            try execute(
              "CREATE TRIGGER IF NOT EXISTS derived_\(table)_\(operation.lowercased()) AFTER \(operation) ON \(table) BEGIN UPDATE derived_state SET revision=revision+1,epoch=epoch+1; END"
            )
          }
        }
        try execute("PRAGMA user_version=6")
      }
      // Seed durable high-water marks for journals created before recovery diagnostics existed.
      if try rows("SELECT value FROM settings WHERE key='highest_reset_revision'").isEmpty {
        var highest =
          Int64(
            try rows("SELECT MAX(revision) AS revision FROM reset_markers").first?["revision"]
              ?? "0") ?? 0
        var rejected: Int64 = 0
        var entity = ""
        var hash = ""
        while true {
          let batch = try rows(
            "SELECT entity_id,payload_hash,payload_json FROM quarantines WHERE (entity_id,payload_hash)>(?,?) ORDER BY entity_id,payload_hash LIMIT 500",
            [.text(entity), .text(hash)])
          if batch.isEmpty { break }
          for row in batch {
            let record = try JSONDecoder().decode(
              MirrorRecord.self, from: Data(row["payload_json"]!.utf8))
            if case .reset(let marker, _) = record {
              highest = max(highest, marker.revision)
              rejected = max(rejected, marker.revision)
            }
          }
          entity = batch.last!["entity_id"]!
          hash = batch.last!["payload_hash"]!
        }
        try execute(
          "INSERT INTO settings VALUES ('highest_reset_revision',?)", [.text(String(highest))])
        try execute(
          "INSERT OR REPLACE INTO settings VALUES ('highest_rejected_reset_revision',?)",
          [.text(String(rejected))])
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
