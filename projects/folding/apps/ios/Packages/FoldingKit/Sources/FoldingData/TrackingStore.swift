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
  let database: SQLiteConnection
  private let partitionLease: PartitionLease?
  nonisolated let exportDirectory: URL
  var exportPurgePending = false
  var derivedCache: PersonalDerivedCache?
  let derivedCacheDirectory: URL
  var derivedBuildObserver: (@Sendable (Bool) async -> Void)?
  public nonisolated let deviceID: UUID

  public init(directory: URL, installationID: UUID, partitionLease: PartitionLease? = nil) throws {
    if let partitionLease {
      guard partitionLease.installationID == installationID else { throw PartitionError.inactive }
      guard
        directory.standardizedFileURL
          == partitionLease.directory.appendingPathComponent("journal").standardizedFileURL
      else { throw PartitionError.inactive }
      self.database = try partitionLease.withActive {
        try Self.openConnection(directory: directory, installationID: installationID)
      }
    } else {
      self.database = try Self.openConnection(directory: directory, installationID: installationID)
    }
    self.partitionLease = partitionLease
    self.exportDirectory = directory.appendingPathComponent("exports", isDirectory: true)
    self.derivedCacheDirectory = directory.appendingPathComponent("derived", isDirectory: true)
    self.deviceID = installationID
  }

  private nonisolated static func openConnection(directory: URL, installationID: UUID) throws
    -> SQLiteConnection
  {
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
        // Preserve the original source facts for diagnosis; never replay a restored
        // installation's pending observations as this phone or into its public grant.
        try connection.execute(
          "UPDATE captured_observations SET state='quarantined',lease_token=NULL,lease_until_ms=NULL,last_error='installation_changed' WHERE device_id<>?",
          [.text(installationID.canonical)])
        try connection.retireInstallation(previous)
        try connection.execute(
          "DELETE FROM settings WHERE key IN ('competition_epoch','competition_transfer','competition_history_before')"
        )
        try connection.execute(
          "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset','competition_history')"
        )
        try connection.execute("UPDATE setup_attempt SET status='cancelled' WHERE status='waiting'")
      }
      try connection.execute(
        "INSERT INTO settings(key,value) VALUES ('installation_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(installationID.canonical)])
      try connection.execute(
        "INSERT OR IGNORE INTO source_state(device_id,next_sequence) VALUES (?,1)",
        [.text(installationID.canonical)])
    }
    return connection
  }

  /// Router holds the exclusive fence while preparing an inaccessible target partition.
  nonisolated static func preparePartitionActivation(directory: URL, installationID: UUID) throws {
    let connection = try openConnection(directory: directory, installationID: installationID)
    try connection.transaction {
      let sequence = try connection.rows(
        "SELECT next_sequence FROM source_state WHERE device_id=?",
        [.text(installationID.uuidString.lowercased())]
      ).first?["next_sequence"]
      if let sequence, let next = Int64(sequence), next > 1 {
        try connection.retireInstallation(
          installationID.uuidString.lowercased(), reason: .trackingInterruption)
      }
      try connection.execute(
        "DELETE FROM settings WHERE key IN ('competition_epoch','competition_transfer','competition_history_before')"
      )
      try connection.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset','competition_history')"
      )
      try connection.execute("UPDATE setup_attempt SET status='cancelled' WHERE status='waiting'")
    }
  }

  public func currentGeneration() throws -> ResetGeneration {
    try journalTransaction(write: false) { try generation() }
  }

  func journalTransaction<T>(write: Bool = true, _ operation: () throws -> T) throws -> T {
    if let partitionLease {
      return try partitionLease.withActive { try fencedJournalTransaction(write: write, operation) }
    }
    return try fencedJournalTransaction(write: write, operation)
  }

  private func fencedJournalTransaction<T>(write: Bool, _ operation: () throws -> T) throws -> T {
    defer {
      if exportPurgePending {
        // The generation fence is authoritative even if protected files cannot be removed yet.
        // Export service startup/prepare retries stale-manifest cleanup after unlock.
        try? ExportFiles.purge(exportDirectory)
        exportPurgePending = false
      }
    }
    return try database.transaction(write: write) {
      guard
        try database.rows("SELECT value FROM settings WHERE key='installation_id'").first?["value"]
          == deviceID.canonical
      else { throw StoreError.installationChanged }
      return try operation()
    }
  }

  func generation() throws -> ResetGeneration {
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

  func nextSequence() throws -> Int64 {
    guard
      let raw = try database.rows(
        "SELECT next_sequence FROM source_state WHERE device_id=?", [.text(deviceID.canonical)]
      ).first?["next_sequence"],
      let sequence = Int64(raw)
    else { throw StoreError.invalidInput }
    return sequence
  }

  func events(includeQuarantined: Bool = false) throws -> [TrackingEvent] {
    try database.rows(
      includeQuarantined
        ? "SELECT payload_json FROM events ORDER BY device_id,sequence"
        : "SELECT payload_json FROM events WHERE event_id NOT IN (SELECT entity_id FROM quarantines) ORDER BY device_id,sequence"
    ).map {
      try decode($0["payload_json"]!)
    }
  }

  func interruptions() throws -> [TrackingInterruption] {
    try database.rows(
      "SELECT payload_json FROM interruptions WHERE interruption_id NOT IN (SELECT entity_id FROM quarantines)"
    ).map {
      try decode($0["payload_json"]!)
    }
  }

  func insert(_ event: TrackingEvent) throws {
    if let pending = try database.rows(
      "SELECT payload_json FROM captured_observations WHERE event_id=? OR (device_id=? AND sequence=?)",
      [.text(event.eventID.canonical), .text(event.deviceID.canonical), .integer(event.sequence)]
    ).first {
      guard (try decode(pending["payload_json"]!) as TrackingEvent) == event else {
        throw StoreError.identityConflict
      }
    }
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

  func enqueue(_ kind: String, entity: UUID, generation: ResetGeneration) throws {
    try database.execute(
      "INSERT INTO work_outbox(work_id,kind,entity_id,generation_id) VALUES (?,?,?,?)",
      [
        .text(UUID().canonical), .text(kind), .text(entity.canonical),
        .text(generation.resetID.canonical),
      ])
  }

  func validateTime(_ value: Int64) throws {
    guard (0...TrackingReducer.maximumInteger).contains(value) else {
      throw StoreError.invalidInput
    }
  }

  func encode<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  func decode<T: Decodable>(_ value: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(value.utf8))
  }
}

extension UUID {
  var canonical: String { uuidString.lowercased() }
}
