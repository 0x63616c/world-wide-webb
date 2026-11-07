import CryptoKit
import FoldingDomain
import Foundation

public struct Observation: Sendable {
  public let id: UUID
  public let generation: ResetGeneration
  public let transition: Transition
  public let observedAtMS: Int64
  public let timezoneID: String
  public let competitionEpochID: UUID?

  public init(
    id: UUID = UUID(), generation: ResetGeneration, transition: Transition,
    observedAtMS: Int64, timezoneID: String, competitionEpochID: UUID? = nil
  ) {
    self.id = id
    self.generation = generation
    self.transition = transition
    self.observedAtMS = observedAtMS
    self.timezoneID = timezoneID
    self.competitionEpochID = competitionEpochID
  }
}

public struct RecordingReceipt: Sendable, Equatable {
  public let event: TrackingEvent
  public let wasRetry: Bool
}

public struct SetupAttempt: Sendable, Equatable {
  public let id: UUID
  public let expiresAtMS: Int64
}

/// One instance per app/intent process. The database transaction, not this actor, arbitrates writers.
/// Give each private iCloud account namespace its own protected directory.
public actor TrackingStore {
  private let database: SQLiteConnection
  public nonisolated let deviceID: UUID

  public init(directory: URL, installationID: UUID) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: directory.path)
    #endif
    let connection = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
    try connection.migrate()
    #if os(iOS)
      for name in ["journal.sqlite", "journal.sqlite-wal", "journal.sqlite-shm"] {
        let file = directory.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: file.path) {
          try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: file.path)
        }
      }
    #endif
    try connection.transaction {
      let previous = try connection.rows("SELECT value FROM settings WHERE key='installation_id'")
        .first?["value"]
      if let previous, previous != installationID.canonical {
        try connection.retireInstallation(previous)
        try connection.execute("DELETE FROM settings WHERE key='competition_epoch'")
        try connection.execute(
          "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset')")
        try connection.execute("UPDATE setup_attempt SET status='cancelled' WHERE status='waiting'")
      }
      try connection.execute(
        "INSERT INTO settings(key,value) VALUES ('installation_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(installationID.canonical)])
      try connection.execute(
        "INSERT OR IGNORE INTO source_state(device_id,next_sequence) VALUES (?,1)",
        [.text(installationID.canonical)])
    }
    self.database = connection
    self.deviceID = installationID
  }

  public func currentGeneration() throws -> ResetGeneration {
    try journalTransaction(write: false) { try generation() }
  }

  public func record(_ observation: Observation, nowMS: Int64) throws -> RecordingReceipt {
    try validateTime(nowMS)
    return try journalTransaction {
      let current = try generation()
      guard observation.generation == current else { throw StoreError.staleGeneration }
      if let row = try database.rows(
        "SELECT payload_json FROM events WHERE event_id=?", [.text(observation.id.canonical)]
      ).first {
        let existing: TrackingEvent = try decode(row["payload_json"]!)
        guard existing.deviceID == deviceID, existing.transition == observation.transition,
          existing.observedAtMS == observation.observedAtMS,
          existing.timezoneID == observation.timezoneID,
          existing.competitionEpochID == observation.competitionEpochID,
          existing.generation == current
        else { throw StoreError.identityConflict }
        return RecordingReceipt(event: existing, wasRetry: true)
      }
      let sequence = try nextSequence()
      guard sequence < TrackingReducer.maximumInteger else { throw StoreError.exhaustedSequence }
      try database.execute(
        "UPDATE setup_attempt SET status='expired' WHERE status='waiting' AND expires_at_ms<=?",
        [.integer(nowMS)])
      let attempt = try database.rows(
        """
        SELECT attempt_id FROM setup_attempt WHERE device_id=? AND generation_id=?
        AND status='waiting' AND expected_transition=? AND baseline_sequence<? AND expires_at_ms>?
        """,
        [
          .text(deviceID.canonical), .text(current.resetID.canonical),
          .text(observation.transition.rawValue),
          .integer(sequence), .integer(nowMS),
        ]
      ).first?["attempt_id"]
      let event = TrackingEvent(
        schemaVersion: 1, eventID: observation.id, deviceID: deviceID,
        sequence: sequence, generation: current, observedAtMS: observation.observedAtMS,
        timezoneID: observation.timezoneID, transition: observation.transition,
        isTest: attempt != nil, competitionEpochID: observation.competitionEpochID)
      _ = try TrackingReducer.reduce(events: [event], generation: current)
      try insert(event)
      try database.execute(
        "UPDATE source_state SET next_sequence=? WHERE device_id=?",
        [.integer(sequence + 1), .text(deviceID.canonical)])
      if let attempt {
        try database.execute(
          "UPDATE setup_attempt SET status='consumed', consumed_event_id=? WHERE attempt_id=?",
          [.text(event.eventID.canonical), .text(attempt)])
      }
      try enqueue("mirror_event", entity: event.eventID, generation: current)
      if !event.isTest, let epoch = event.competitionEpochID,
        epoch == (try competitionEpoch())
      {
        try enqueue("competition_event", entity: event.eventID, generation: current)
      }
      // Read models are replayed from the committed journal until persistent caches are introduced.
      return RecordingReceipt(event: event, wasRetry: false)
    }
  }

  public func beginSetupTest(expected: Transition, nowMS: Int64) throws -> SetupAttempt {
    try validateTime(nowMS)
    guard nowMS <= TrackingReducer.maximumInteger - 120_000 else { throw StoreError.invalidInput }
    return try journalTransaction {
      let current = try generation()
      try database.execute(
        "UPDATE setup_attempt SET status='cancelled' WHERE device_id=? AND status='waiting'",
        [.text(deviceID.canonical)])
      let attempt = SetupAttempt(id: UUID(), expiresAtMS: nowMS + 120_000)
      try database.execute(
        """
        INSERT INTO setup_attempt(attempt_id,device_id,generation_id,expected_transition,baseline_sequence,expires_at_ms,status)
        VALUES (?,?,?,?,?,?,'waiting')
        """,
        [
          .text(attempt.id.canonical), .text(deviceID.canonical), .text(current.resetID.canonical),
          .text(expected.rawValue), .integer(try nextSequence() - 1), .integer(attempt.expiresAtMS),
        ])
      return attempt
    }
  }

  public func setupTestPassed(_ id: UUID) throws -> Bool {
    try database.rows("SELECT status FROM setup_attempt WHERE attempt_id=?", [.text(id.canonical)])
      .first?["status"] == "consumed"
  }

  public func summary() throws -> TrackingSummary {
    try journalTransaction(write: false) {
      try TrackingReducer.reduce(
        events: events(), interruptions: interruptions(), generation: generation())
    }
  }

  public func retainedEvents() throws -> [TrackingEvent] {
    try journalTransaction(write: false) { try events() }
  }

  /// Import never allocates a local sequence or creates public submission work.
  public func importEvent(_ event: TrackingEvent) throws {
    _ = try TrackingReducer.reduce(events: [event], generation: event.generation)
    try journalTransaction {
      let current = try generation()
      if event.generation < current { return }
      guard event.generation == current else { throw StoreError.staleGeneration }
      if let row = try database.rows(
        "SELECT payload_json FROM events WHERE event_id=?", [.text(event.eventID.canonical)]
      ).first {
        let old: TrackingEvent = try decode(row["payload_json"]!)
        guard old == event else { throw StoreError.identityConflict }
        return
      }
      guard
        try database.rows(
          "SELECT event_id FROM events WHERE device_id=? AND sequence=?",
          [.text(event.deviceID.canonical), .integer(event.sequence)]
        ).isEmpty
      else { throw StoreError.identityConflict }
      try insert(event)
      // A mirror replay from this installation must not let the allocator reuse a sequence.
      if event.deviceID == deviceID {
        guard event.sequence < TrackingReducer.maximumInteger else {
          throw StoreError.exhaustedSequence
        }
        try database.execute(
          "UPDATE source_state SET next_sequence=MAX(next_sequence,?) WHERE device_id=?",
          [.integer(event.sequence + 1), .text(deviceID.canonical)])
      }
    }
  }

  /// Capture once and retain this immutable marker across retries.
  public func interruption(reason: InterruptionReason, nowMS: Int64) throws -> TrackingInterruption
  {
    try validateTime(nowMS)
    return try journalTransaction(write: false) {
      TrackingInterruption(
        interruptionID: UUID(), deviceID: deviceID, generation: try generation(),
        afterSequence: try nextSequence() - 1, reason: reason, observedAtMS: nowMS)
    }
  }

  public func recordInterruption(_ marker: TrackingInterruption) throws {
    _ = try TrackingReducer.reduce(
      events: [], interruptions: [marker], generation: marker.generation)
    try journalTransaction {
      guard marker.generation == (try generation()) else { throw StoreError.staleGeneration }
      guard marker.deviceID == deviceID, marker.afterSequence < (try nextSequence()) else {
        throw StoreError.invalidInput
      }
      if let row = try database.rows(
        "SELECT payload_json FROM interruptions WHERE interruption_id=?",
        [.text(marker.interruptionID.canonical)]
      ).first {
        let existing: TrackingInterruption = try decode(row["payload_json"]!)
        guard existing == marker else { throw StoreError.identityConflict }
        return
      }
      try database.execute(
        "INSERT INTO interruptions VALUES (?,?,?,?,?)",
        [
          .text(marker.interruptionID.canonical), .text(deviceID.canonical),
          .text(marker.generation.resetID.canonical), .integer(marker.afterSequence),
          .text(try encode(marker)),
        ])
      try enqueue(
        "mirror_interruption", entity: marker.interruptionID, generation: marker.generation)
    }
  }

  /// Called only with the confirmed enrollment response; this is local state, not server authorization.
  public func setCompetitionEpoch(_ epoch: UUID?) throws {
    try journalTransaction {
      try database.execute("DELETE FROM settings WHERE key='competition_epoch'")
      if let epoch {
        try database.execute(
          "INSERT INTO settings(key,value) VALUES ('competition_epoch',?)", [.text(epoch.canonical)]
        )
      } else {
        try database.execute(
          "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset')")
      }
    }
  }

  public func currentCompetitionEpoch() throws -> UUID? {
    try journalTransaction(write: false) { try competitionEpoch() }
  }

  private func competitionEpoch() throws -> UUID? {
    try database.rows("SELECT value FROM settings WHERE key='competition_epoch'").first?["value"]
      .flatMap(UUID.init(uuidString:))
  }

  public func reset(id: UUID = UUID(), nowMS: Int64) throws
    -> ResetGeneration
  {
    try validateTime(nowMS)
    return try journalTransaction {
      if let row = try database.rows(
        "SELECT revision FROM reset_markers WHERE reset_id=?", [.text(id.canonical)]
      ).first,
        let revision = Int64(row["revision"]!)
      {
        return ResetGeneration(revision: revision, resetID: id)
      }
      let previous = try generation()
      guard
        previous.revision < TrackingReducer.maximumInteger && id != ResetGeneration.initial.resetID
      else { throw StoreError.invalidInput }
      let marker = ResetGeneration(revision: previous.revision + 1, resetID: id)
      try adoptReset(marker, nowMS: nowMS)
      try enqueue("mirror_reset", entity: id, generation: marker)
      return marker
    }
  }

  public func importReset(_ marker: ResetGeneration, createdAtMS: Int64) throws {
    try validateTime(createdAtMS)
    _ = try TrackingReducer.reduce(events: [], generation: marker)
    guard marker.revision > 0 else { throw StoreError.invalidInput }
    try journalTransaction { try adoptReset(marker, nowMS: createdAtMS) }
  }

  public func importInterruption(_ marker: TrackingInterruption) throws {
    _ = try TrackingReducer.reduce(
      events: [], interruptions: [marker], generation: marker.generation)
    try journalTransaction {
      let current = try generation()
      if marker.generation < current { return }
      guard marker.generation == current else { throw StoreError.staleGeneration }
      if let row = try database.rows(
        "SELECT payload_json FROM interruptions WHERE interruption_id=?",
        [.text(marker.interruptionID.canonical)]
      ).first {
        let old: TrackingInterruption = try decode(row["payload_json"]!)
        guard old == marker else { throw StoreError.identityConflict }
        return
      }
      try database.execute(
        "INSERT INTO interruptions VALUES (?,?,?,?,?)",
        [
          .text(marker.interruptionID.canonical), .text(marker.deviceID.canonical),
          .text(marker.generation.resetID.canonical), .integer(marker.afterSequence),
          .text(try encode(marker)),
        ])
    }
  }

  public func leaseMirrorWork(nowMS: Int64, limit: Int = 50) throws -> [MirrorLease] {
    guard (1...100).contains(limit), nowMS >= 0,
      nowMS <= TrackingReducer.maximumInteger - 60_000
    else { throw StoreError.invalidInput }
    return try journalTransaction {
      let rows = try database.rows(
        """
        SELECT work_id,kind,entity_id FROM work_outbox
        WHERE kind IN ('mirror_event','mirror_reset','mirror_interruption') AND next_attempt_ms<=?
        AND (state='pending' OR (state='leased' AND lease_until_ms<=?))
        ORDER BY CASE kind WHEN 'mirror_reset' THEN 0 ELSE 1 END, work_id LIMIT ?
        """, [.integer(nowMS), .integer(nowMS), .integer(Int64(limit))])
      return try rows.map { row in
        let token = UUID()
        guard let workID = UUID(uuidString: row["work_id"]!), let entity = row["entity_id"] else {
          throw StoreError.invalidInput
        }
        let record: MirrorRecord
        switch row["kind"] {
        case "mirror_event":
          guard
            let payload = try database.rows(
              "SELECT payload_json FROM events WHERE event_id=?", [.text(entity)]
            ).first?["payload_json"]
          else { throw StoreError.invalidInput }
          record = .event(try decode(payload))
        case "mirror_interruption":
          guard
            let payload = try database.rows(
              "SELECT payload_json FROM interruptions WHERE interruption_id=?", [.text(entity)]
            ).first?["payload_json"]
          else { throw StoreError.invalidInput }
          record = .interruption(try decode(payload))
        case "mirror_reset":
          guard
            let marker = try database.rows(
              "SELECT revision,created_at_ms FROM reset_markers WHERE reset_id=?", [.text(entity)]
            ).first,
            let id = UUID(uuidString: entity), let revision = Int64(marker["revision"]!),
            let created = Int64(marker["created_at_ms"]!)
          else { throw StoreError.invalidInput }
          record = .reset(ResetGeneration(revision: revision, resetID: id), createdAtMS: created)
        default: throw StoreError.invalidInput
        }
        try database.execute(
          "UPDATE work_outbox SET state='leased',lease_until_ms=?,lease_token=?,attempt_count=attempt_count+1 WHERE work_id=?",
          [.integer(nowMS + 60_000), .text(token.canonical), .text(workID.canonical)])
        return MirrorLease(workID: workID, token: token, record: record)
      }
    }
  }

  /// This acknowledges a local mirror save, not confirmed iCloud upload or cross-device convergence.
  public func acknowledgeMirror(_ lease: MirrorLease) throws {
    try journalTransaction {
      try database.execute(
        "UPDATE work_outbox SET state='mirrored_locally',lease_until_ms=NULL,lease_token=NULL WHERE work_id=? AND lease_token=? AND state='leased'",
        [.text(lease.workID.canonical), .text(lease.token.canonical)])
    }
  }

  public func retryMirror(_ lease: MirrorLease, atMS: Int64) throws {
    try validateTime(atMS)
    try journalTransaction {
      try database.execute(
        "UPDATE work_outbox SET state='pending',lease_until_ms=NULL,lease_token=NULL,next_attempt_ms=? WHERE work_id=? AND lease_token=? AND state='leased'",
        [.integer(atMS), .text(lease.workID.canonical), .text(lease.token.canonical)])
    }
  }

  private func adoptReset(_ marker: ResetGeneration, nowMS: Int64) throws {
    if let row = try database.rows(
      "SELECT revision,created_at_ms FROM reset_markers WHERE reset_id=?",
      [.text(marker.resetID.canonical)]
    ).first {
      guard row["revision"] == String(marker.revision), row["created_at_ms"] == String(nowMS) else {
        throw StoreError.identityConflict
      }
      return
    }
    let old = try generation()
    try database.execute(
      "INSERT INTO reset_markers VALUES (?,?,?)",
      [.text(marker.resetID.canonical), .integer(marker.revision), .integer(nowMS)])
    guard marker > old else { return }
    try database.execute("DELETE FROM events")
    try database.execute("DELETE FROM interruptions")
    try database.execute("DELETE FROM setup_attempt")
    try database.execute("DELETE FROM work_outbox WHERE kind!='mirror_reset'")
    if try competitionEpoch() != nil {
      try enqueue("competition_reset", entity: marker.resetID, generation: marker)
    }
  }

  private func journalTransaction<T>(write: Bool = true, _ operation: () throws -> T) throws -> T {
    try database.transaction(write: write) {
      guard
        try database.rows("SELECT value FROM settings WHERE key='installation_id'").first?["value"]
          == deviceID.canonical
      else { throw StoreError.installationChanged }
      return try operation()
    }
  }

  private func generation() throws -> ResetGeneration {
    guard
      let row = try database.rows(
        "SELECT revision,reset_id FROM reset_markers ORDER BY revision DESC,reset_id DESC LIMIT 1"
      ).first
    else { return .initial }
    guard let revision = Int64(row["revision"]!), let id = UUID(uuidString: row["reset_id"]!) else {
      throw StoreError.invalidInput
    }
    return ResetGeneration(revision: revision, resetID: id)
  }

  private func nextSequence() throws -> Int64 {
    guard
      let raw = try database.rows(
        "SELECT next_sequence FROM source_state WHERE device_id=?", [.text(deviceID.canonical)]
      ).first?["next_sequence"],
      let sequence = Int64(raw)
    else { throw StoreError.invalidInput }
    return sequence
  }

  private func events() throws -> [TrackingEvent] {
    try database.rows("SELECT payload_json FROM events ORDER BY device_id,sequence").map {
      try decode($0["payload_json"]!)
    }
  }

  private func interruptions() throws -> [TrackingInterruption] {
    try database.rows("SELECT payload_json FROM interruptions").map {
      try decode($0["payload_json"]!)
    }
  }

  private func insert(_ event: TrackingEvent) throws {
    let payload = try encode(event)
    let hash = SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined()
    try database.execute(
      "INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        .text(event.eventID.canonical), .text(event.deviceID.canonical), .integer(event.sequence),
        .integer(event.generation.revision), .text(event.generation.resetID.canonical),
        .integer(event.observedAtMS),
        .text(event.timezoneID), .text(event.transition.rawValue), .integer(event.isTest ? 1 : 0),
        event.competitionEpochID.map { .text($0.canonical) } ?? .null, .text(payload), .text(hash),
      ])
  }

  private func enqueue(_ kind: String, entity: UUID, generation: ResetGeneration) throws {
    try database.execute(
      "INSERT INTO work_outbox(work_id,kind,entity_id,generation_id) VALUES (?,?,?,?)",
      [
        .text(UUID().canonical), .text(kind), .text(entity.canonical),
        .text(generation.resetID.canonical),
      ])
  }

  private func validateTime(_ value: Int64) throws {
    guard (0...TrackingReducer.maximumInteger).contains(value) else {
      throw StoreError.invalidInput
    }
  }

  private func encode<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  private func decode<T: Decodable>(_ value: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(value.utf8))
  }
}

extension UUID {
  fileprivate var canonical: String { uuidString.lowercased() }
}
