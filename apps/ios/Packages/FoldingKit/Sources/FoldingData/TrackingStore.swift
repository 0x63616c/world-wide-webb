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
  private let partitionLease: PartitionLease?
  nonisolated let exportDirectory: URL
  private var exportPurgePending = false
  private var derivedCache: PersonalDerivedCache?
  private let derivedCacheDirectory: URL
  private var derivedBuildObserver: (@Sendable (Bool) async -> Void)?
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
          "DELETE FROM settings WHERE key IN ('competition_epoch','competition_transfer')")
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
        "DELETE FROM settings WHERE key IN ('competition_epoch','competition_transfer')")
      try connection.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset')")
      try connection.execute("UPDATE setup_attempt SET status='cancelled' WHERE status='waiting'")
    }
  }

  public func currentGeneration() throws -> ResetGeneration {
    try journalTransaction(write: false) { try generation() }
  }

  public func record(_ observation: Observation, nowMS: Int64) throws -> RecordingReceipt {
    try validateTime(nowMS)
    return try journalTransaction {
      let receipt = try captureInTransaction(observation, nowMS: nowMS)
      _ = try materializeCaptureInTransaction(receipt.event)
      try database.execute(
        "DELETE FROM captured_observations WHERE event_id=?",
        [.text(receipt.event.eventID.canonical)])
      return receipt
    }
  }

  /// The entire capture is a single short journal transaction, independent of CloudKit,
  /// history reductions and transport. Sequence, generation, epoch and setup attribution are fixed here.
  public func capture(
    _ transition: Transition, id: UUID = UUID(), observedAtMS: Int64, timezoneID: String,
    nowMS: Int64, dailyLimitPreferences: DailyLimitPreferences? = nil
  ) throws -> CaptureReceipt {
    try validateTime(nowMS)
    return try journalTransaction {
      let cancelled: String?
      if let dailyLimitPreferences {
        cancelled = try setDailyLimitPreferencesInTransaction(dailyLimitPreferences)
      } else {
        cancelled = nil
      }
      let observation = Observation(
        id: id, generation: try generation(), transition: transition,
        observedAtMS: observedAtMS, timezoneID: timezoneID,
        competitionEpochID: try competitionEpoch())
      let receipt = try captureInTransaction(observation, nowMS: nowMS)
      return CaptureReceipt(
        eventID: receipt.event.eventID, wasRetry: receipt.wasRetry,
        cancelledNotificationIdentifier: cancelled)
    }
  }

  private func captureInTransaction(_ observation: Observation, nowMS: Int64) throws
    -> RecordingReceipt
  {
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
    if let row = try database.rows(
      "SELECT payload_json FROM captured_observations WHERE event_id=?",
      [.text(observation.id.canonical)]
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
    try database.execute(
      "INSERT INTO captured_observations(event_id,device_id,sequence,payload_json) VALUES (?,?,?,?)",
      [
        .text(event.eventID.canonical), .text(deviceID.canonical), .integer(sequence),
        .text(try encode(event)),
      ])
    try database.execute(
      "UPDATE source_state SET next_sequence=? WHERE device_id=?",
      [.integer(sequence + 1), .text(deviceID.canonical)])
    if let attempt {
      try database.execute(
        "UPDATE setup_attempt SET status='consumed', consumed_event_id=? WHERE attempt_id=?",
        [.text(event.eventID.canonical), .text(attempt)])
    }
    return RecordingReceipt(event: event, wasRetry: false)
  }

  private func materializeCaptureInTransaction(_ event: TrackingEvent) throws -> RecordingReceipt {
    guard event.deviceID == deviceID else { throw StoreError.installationChanged }
    guard
      try database.rows(
        "SELECT entity_id FROM quarantines WHERE entity_id=?", [.text(event.eventID.canonical)]
      ).isEmpty
    else { throw StoreError.identityConflict }
    guard event.generation == (try generation()) else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM events WHERE event_id=?", [.text(event.eventID.canonical)]
    ).first {
      let existing: TrackingEvent = try decode(row["payload_json"]!)
      guard existing == event else { throw StoreError.identityConflict }
      return RecordingReceipt(event: existing, wasRetry: true)
    }
    try insert(event)
    try enqueue("mirror_event", entity: event.eventID, generation: event.generation)
    if !event.isTest, let epoch = event.competitionEpochID, epoch == (try competitionEpoch()) {
      try enqueue("competition_event", entity: event.eventID, generation: event.generation)
    }
    return RecordingReceipt(event: event, wasRetry: false)
  }

  public func claimCapturedObservation(nowMS: Int64) throws -> CaptureLease? {
    try validateTime(nowMS)
    guard nowMS <= TrackingReducer.maximumInteger - 30_000 else { throw StoreError.invalidInput }
    return try journalTransaction {
      guard
        let head = try database.rows(
          "SELECT * FROM captured_observations WHERE state='pending' ORDER BY sequence LIMIT 1"
        ).first
      else { return nil }
      let due = Int64(head["next_attempt_ms"] ?? "0") ?? 0
      let leasedUntil = Int64(head["lease_until_ms"] ?? "0") ?? 0
      guard due <= nowMS || due > nowMS + 300_000,
        leasedUntil <= nowMS || leasedUntil > nowMS + 30_000
      else { return nil }
      let event: TrackingEvent = try decode(head["payload_json"]!)
      let token = UUID()
      try database.execute(
        "UPDATE captured_observations SET lease_token=?,lease_until_ms=? WHERE event_id=?",
        [.text(token.canonical), .integer(nowMS + 30_000), .text(event.eventID.canonical)])
      return CaptureLease(event: event, token: token)
    }
  }

  /// The queue row remains until local post-commit work acknowledges it. A kill after
  /// this transaction replays the same immutable event and cannot award another fold.
  public func commitCapturedObservation(_ lease: CaptureLease, nowMS: Int64) throws
    -> RecordingReceipt
  {
    try journalTransaction {
      try requireCaptureLease(lease, nowMS: nowMS)
      return try materializeCaptureInTransaction(lease.event)
    }
  }

  public func acknowledgeCapturedObservation(_ lease: CaptureLease) throws {
    try journalTransaction {
      guard
        let row = try database.rows(
          "SELECT payload_json FROM events WHERE event_id=?", [.text(lease.event.eventID.canonical)]
        ).first,
        (try decode(row["payload_json"]!) as TrackingEvent) == lease.event
      else { throw StoreError.invalidInput }
      try database.execute(
        "DELETE FROM captured_observations WHERE event_id=? AND lease_token=?",
        [.text(lease.event.eventID.canonical), .text(lease.token.canonical)])
    }
  }

  public func retryCapturedObservation(
    _ lease: CaptureLease, nowMS: Int64, quarantine: Bool = false
  ) throws {
    try validateTime(nowMS)
    try journalTransaction {
      guard
        let row = try database.rows(
          "SELECT attempt_count FROM captured_observations WHERE event_id=? AND lease_token=?",
          [.text(lease.event.eventID.canonical), .text(lease.token.canonical)]
        ).first
      else { return }
      let attempts = min((Int(row["attempt_count"] ?? "0") ?? 0) + 1, 30)
      let delay: Int64 = min(300_000, 1000 << min(attempts - 1, 9))
      try database.execute(
        "UPDATE captured_observations SET state=?,attempt_count=?,next_attempt_ms=?,lease_token=NULL,lease_until_ms=NULL,last_error=? WHERE event_id=? AND lease_token=?",
        [
          .text(quarantine ? "quarantined" : "pending"), .integer(Int64(attempts)),
          .integer(min(TrackingReducer.maximumInteger, nowMS + delay)),
          .text(quarantine ? "invalid_capture" : "storage_retry"),
          .text(lease.event.eventID.canonical), .text(lease.token.canonical),
        ])
    }
  }

  public func captureRetryStatus() throws -> CaptureRetryStatus {
    try journalTransaction(write: false) {
      let rows = try database.rows(
        "SELECT state,count(*) AS n FROM captured_observations GROUP BY state")
      return CaptureRetryStatus(
        pending: Int(rows.first { $0["state"] == "pending" }?["n"] ?? "0") ?? 0,
        quarantined: Int(rows.first { $0["state"] == "quarantined" }?["n"] ?? "0") ?? 0)
    }
  }

  private func requireCaptureLease(_ lease: CaptureLease, nowMS: Int64) throws {
    try validateTime(nowMS)
    guard
      let row = try database.rows(
        "SELECT * FROM captured_observations WHERE event_id=? AND state='pending' AND lease_token=? AND lease_until_ms>?",
        [.text(lease.event.eventID.canonical), .text(lease.token.canonical), .integer(nowMS)]
      ).first,
      (try decode(row["payload_json"]!) as TrackingEvent) == lease.event
    else { throw CaptureError.invalidLease }
  }

  public func beginSetupTest(expected: Transition, nowMS: Int64) throws -> SetupAttempt {
    try journalTransaction { try beginSetupTestInTransaction(expected: expected, nowMS: nowMS) }
  }

  private func beginSetupTestInTransaction(expected: Transition, nowMS: Int64) throws
    -> SetupAttempt
  {
    try validateTime(nowMS)
    guard nowMS <= TrackingReducer.maximumInteger - 120_000 else { throw StoreError.invalidInput }

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

  public func setupTestPassed(_ id: UUID) throws -> Bool {
    try journalTransaction(write: false) {
      let current = try generation()
      guard
        let row = try database.rows(
          "SELECT consumed_event_id,expected_transition FROM setup_attempt WHERE attempt_id=? AND device_id=? AND generation_id=? AND status='consumed'",
          [.text(id.canonical), .text(deviceID.canonical), .text(current.resetID.canonical)]
        ).first,
        let eventID = row["consumed_event_id"], let event = try setupEvent(id: eventID)
      else { return false }
      return event.isTest && event.deviceID == deviceID && event.generation == current
        && event.transition.rawValue == row["expected_transition"]
    }
  }

  public func setupProgress(nowMS: Int64) throws -> SetupProgress {
    try validateTime(nowMS)
    return try journalTransaction {
      let progress = try loadSetupProgress(nowMS: nowMS)
      try saveSetupProgress(progress)
      return progress
    }
  }

  public func advanceSetup(_ action: SetupAction, nowMS: Int64) throws -> SetupProgress {
    try validateTime(nowMS)
    return try journalTransaction {
      var progress = try loadSetupProgress(nowMS: nowMS)
      switch action {
      case .restart:
        try cancelSetupAttempt(progress.attemptID)
        progress = SetupProgress(
          deviceID: deviceID, generation: try generation(), lastCompletion: progress.lastCompletion)
      case .dismiss:
        try cancelSetupAttempt(progress.attemptID)
        if progress.step == .awaitingOpening { progress.step = .openingReady }
        if progress.step == .awaitingClosing { progress.step = .closingReady }
        progress.attemptID = nil
        progress.expiresAtMS = nil
      case .test:
        guard progress.step == .openingReady || progress.step == .closingReady else {
          throw StoreError.invalidInput
        }
        let opening = progress.step == .openingReady
        let attempt = try beginSetupTestInTransaction(
          expected: opening ? .open : .close, nowMS: nowMS)
        progress.attemptID = attempt.id
        progress.expiresAtMS = attempt.expiresAtMS
        progress.step = opening ? .awaitingOpening : .awaitingClosing
      case .retry:
        guard progress.step == .openingRetry || progress.step == .closingRetry else {
          throw StoreError.invalidInput
        }
        progress.step = progress.step == .openingRetry ? .openingReady : .closingReady
        progress.attemptID = nil
        progress.expiresAtMS = nil
      case .next:
        switch progress.step {
        case .welcome: progress.step = .openingInstructions
        case .openingInstructions: progress.step = .openingReady
        case .openingPassed: progress.step = .closingInstructions
        case .closingInstructions: progress.step = .closingReady
        case .closingPassed:
          guard let opening = progress.openingEventID, let closing = progress.closingEventID else {
            throw StoreError.invalidInput
          }
          progress.step = .complete
          progress.lastCompletion = SetupCompletion(
            flowID: progress.flowID, deviceID: deviceID, generation: progress.generation,
            openingEventID: opening, closingEventID: closing, completedAtMS: nowMS)
        default: throw StoreError.invalidInput
        }
      }
      try saveSetupProgress(progress)
      return progress
    }
  }

  private func loadSetupProgress(nowMS: Int64) throws -> SetupProgress {
    let current = try generation()
    guard
      let raw = try database.rows("SELECT value FROM settings WHERE key='setup_progress'").first?[
        "value"]
    else {
      return SetupProgress(deviceID: deviceID, generation: current)
    }
    var progress: SetupProgress = try decode(raw)
    guard progress.schemaVersion == 1 else { throw StoreError.incompatibleSchema }
    if progress.deviceID != deviceID || progress.generation != current {
      try cancelSetupAttempt(progress.attemptID)
      var restarted = SetupProgress(
        deviceID: deviceID, generation: current, lastCompletion: progress.lastCompletion)
      restarted.step = .openingReady
      return restarted
    }
    // Cached UI success never substitutes for retained, non-quarantined commit evidence.
    for (id, expected) in [
      (progress.openingEventID, Transition.open), (progress.closingEventID, Transition.close),
    ] {
      guard let id else { continue }
      let event = try setupEvent(id: id.canonical)
      if event?.isTest != true || event?.deviceID != deviceID || event?.generation != current
        || event?.transition != expected
      {
        try cancelSetupAttempt(progress.attemptID)
        progress.attemptID = nil
        progress.expiresAtMS = nil
        if expected == .open {
          progress.openingEventID = nil
          progress.closingEventID = nil
          progress.step = .openingReady
          break
        } else {
          progress.closingEventID = nil
          progress.step = .closingReady
        }
      }
    }
    if progress.step.isWaiting {
      guard let id = progress.attemptID else { throw StoreError.invalidInput }
      let expected: Transition = progress.step == .awaitingOpening ? .open : .close
      let row = try database.rows(
        "SELECT status,consumed_event_id,expires_at_ms FROM setup_attempt WHERE attempt_id=? AND device_id=? AND generation_id=? AND expected_transition=?",
        [
          .text(id.canonical), .text(deviceID.canonical), .text(current.resetID.canonical),
          .text(expected.rawValue),
        ]
      ).first
      if row?["status"] == "consumed", let eventID = row?["consumed_event_id"],
        let event = try setupEvent(id: eventID), event.isTest,
        event.deviceID == deviceID, event.generation == current, event.transition == expected
      {
        if expected == .open {
          progress.openingEventID = event.eventID
          progress.step = .openingPassed
        } else {
          progress.closingEventID = event.eventID
          progress.step = .closingPassed
        }
      } else if row?["status"] != "waiting" || (Int64(row?["expires_at_ms"] ?? "0") ?? 0) <= nowMS {
        try cancelSetupAttempt(id)
        progress.step = expected == .open ? .openingRetry : .closingRetry
      }
    }
    return progress
  }

  private func setupEvent(id: String) throws -> TrackingEvent? {
    guard
      let raw = try database.rows(
        "SELECT payload_json FROM events WHERE event_id=? AND event_id NOT IN (SELECT entity_id FROM quarantines) UNION ALL SELECT payload_json FROM captured_observations WHERE event_id=? AND state='pending' AND event_id NOT IN (SELECT entity_id FROM quarantines) LIMIT 1",
        [.text(id), .text(id)]
      ).first?["payload_json"]
    else { return nil }
    return try decode(raw)
  }

  private func cancelSetupAttempt(_ id: UUID?) throws {
    if let id {
      try database.execute(
        "UPDATE setup_attempt SET status='cancelled' WHERE attempt_id=? AND status='waiting'",
        [.text(id.canonical)])
    }
  }

  private func saveSetupProgress(_ progress: SetupProgress) throws {
    try database.execute(
      "INSERT INTO settings(key,value) VALUES ('setup_progress',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [.text(try encode(progress))])
  }

  /// Select a private tracking phone. This does not issue or change a public competition epoch.
  /// The transaction captures exactly the source sequences known at this handover.
  public func selectTrackingDevice(_ activeDeviceID: UUID, nowMS: Int64) throws
    -> PrivateTransferMarker
  {
    try validateTime(nowMS)
    return try journalTransaction {
      try selectTrackingDeviceInTransaction(activeDeviceID, transferID: UUID(), nowMS: nowMS)
    }
  }

  private func selectTrackingDeviceInTransaction(
    _ activeDeviceID: UUID, transferID: UUID, nowMS: Int64
  ) throws -> PrivateTransferMarker {
    let markers = try transferMarkersInTransaction()
    let knownSource = try !database.rows(
      "SELECT device_id FROM known_source_sequences WHERE device_id=?",
      [.text(activeDeviceID.canonical)]
    ).isEmpty
    guard
      activeDeviceID == deviceID || knownSource
        || markers.contains(where: {
          $0.activeDeviceID == activeDeviceID || $0.sourceWatermarks[activeDeviceID] != nil
        })
    else { throw StoreError.invalidInput }
    var watermarks: [UUID: Int64] = [:]
    // Remember earlier captured knowledge even if that source has since been selected active.
    for prior in markers {
      for (source, sequence) in prior.sourceWatermarks {
        watermarks[source] = max(watermarks[source, default: 0], sequence)
      }
    }
    for row in try database.rows("SELECT device_id,sequence FROM known_source_sequences") {
      guard let source = row["device_id"].flatMap(UUID.init(uuidString:)),
        let sequence = row["sequence"].flatMap(Int64.init)
      else { throw StoreError.invalidInput }
      watermarks[source] = max(watermarks[source, default: 0], sequence)
    }
    watermarks.removeValue(forKey: activeDeviceID)
    let highest =
      try database.rows("SELECT MAX(revision) AS revision FROM transfer_markers").first?[
        "revision"
      ].flatMap(Int64.init) ?? 0
    guard highest < TrackingReducer.maximumInteger else { throw StoreError.exhaustedSequence }
    let marker = PrivateTransferMarker(
      transferID: transferID, revision: highest + 1, activeDeviceID: activeDeviceID,
      sourceWatermarks: watermarks, createdAtMS: nowMS)
    try importTransferInTransaction(marker)
    let current = try generation()
    for (source, sequence) in watermarks {
      let boundary = TrackingInterruption(
        interruptionID: UUID(), deviceID: source, generation: current,
        afterSequence: sequence, reason: .transferAway, observedAtMS: nowMS)
      try importInterruptionInTransaction(boundary)
      try enqueue("mirror_interruption", entity: boundary.interruptionID, generation: current)
    }
    // Transfer work is generation-independent and survives all event reset cleanup.
    try enqueue("mirror_transfer", entity: marker.transferID, generation: .initial)
    return marker
  }

  /// A durable intent scoped to this private partition, account, installation and reset generation.
  public func beginCompetitionTransfer(
    participantID: UUID, fromEpochID: UUID, replaceChangedEpoch: Bool = false
  ) throws -> PendingCompetitionTransfer {
    try journalTransaction {
      let current = try generation()
      if let row = try database.rows("SELECT value FROM settings WHERE key='competition_transfer'")
        .first
      {
        let pending: PendingCompetitionTransfer = try decode(row["value"]!)
        if pending.participantID == participantID && pending.deviceID == deviceID
          && pending.generation == current
          && (!replaceChangedEpoch || pending.fromEpochID == fromEpochID)
        {
          return pending
        }
      }
      let pending = PendingCompetitionTransfer(
        operationID: UUID(), resetOperationID: UUID(), participantID: participantID,
        deviceID: deviceID, fromEpochID: fromEpochID, generation: current)
      try database.execute(
        "INSERT INTO settings(key,value) VALUES ('competition_transfer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(try encode(pending))])
      return pending
    }
  }

  public func pendingCompetitionTransfer() throws -> PendingCompetitionTransfer? {
    try journalTransaction(write: false) {
      guard
        let row = try database.rows("SELECT value FROM settings WHERE key='competition_transfer'")
          .first
      else { return nil }
      return try decode(row["value"]!)
    }
  }

  /// The server response is authoritative; local selection and epoch become visible together.
  public func completeCompetitionTransfer(
    _ pending: PendingCompetitionTransfer, epochID: UUID, nowMS: Int64
  ) throws {
    try validateTime(nowMS)
    try journalTransaction {
      guard pending.deviceID == deviceID, pending.generation == (try generation()) else {
        throw StoreError.staleGeneration
      }
      guard
        let row = try database.rows("SELECT value FROM settings WHERE key='competition_transfer'")
          .first
      else {
        if try competitionEpoch() == epochID,
          try transferMarkersInTransaction().contains(where: {
            $0.transferID == pending.operationID && $0.activeDeviceID == deviceID
          })
        {
          return
        }
        throw StoreError.invalidInput
      }
      let saved: PendingCompetitionTransfer = try decode(row["value"]!)
      guard saved == pending else { throw StoreError.invalidInput }
      _ = try selectTrackingDeviceInTransaction(
        deviceID, transferID: pending.operationID, nowMS: nowMS)
      try setCompetitionEpochInTransaction(epochID)
      try database.execute("DELETE FROM settings WHERE key='competition_transfer'")
    }
  }

  public func privateTransferMarkers() throws -> [PrivateTransferMarker] {
    try journalTransaction(write: false) { try transferMarkersInTransaction() }
  }

  private func transferMarkersInTransaction() throws -> [PrivateTransferMarker] {
    try database.rows(
      "SELECT payload_json FROM transfer_markers WHERE transfer_id NOT IN (SELECT transfer_id FROM rejected_transfer_ids) ORDER BY revision,transfer_id"
    )
    .map { try decode($0["payload_json"]!) }
  }

  private func importTransferInTransaction(_ marker: PrivateTransferMarker) throws {
    _ = try PrivateTransferPolicy.winner([marker])
    let id = marker.transferID.canonical
    let rejected = try !database.rows(
      "SELECT transfer_id FROM rejected_transfer_ids WHERE transfer_id=?", [.text(id)]
    ).isEmpty
    if let row = try database.rows(
      "SELECT payload_json FROM transfer_markers WHERE transfer_id=?", [.text(id)]
    ).first {
      let old: PrivateTransferMarker = try decode(row["payload_json"]!)
      if rejected || old != marker {
        try rejectTransferInTransaction(marker.transferID)
        // Never choose the first/last conflicting payload. The rejection survives reset and replay.
      }
      return
    }
    guard !rejected else { return }
    try database.execute(
      "INSERT INTO transfer_markers VALUES (?,?,?)",
      [
        .text(id), .integer(marker.revision), .text(try encode(marker)),
      ])
  }

  private func rejectTransferInTransaction(_ id: UUID) throws {
    let existing = try !database.rows(
      "SELECT transfer_id FROM rejected_transfer_ids WHERE transfer_id=?", [.text(id.canonical)]
    ).isEmpty
    try database.execute(
      "INSERT OR IGNORE INTO rejected_transfer_ids VALUES (?)", [.text(id.canonical)])
    // Reuse this logical record's work. A rejection supersedes any already-leased original.
    if !existing {
      try database.execute(
        "UPDATE work_outbox SET state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=0 WHERE kind='mirror_transfer' AND entity_id=?",
        [.text(id.canonical)])
    }
    try database.execute(
      "INSERT OR IGNORE INTO work_outbox(work_id,kind,entity_id,generation_id) VALUES (?,'mirror_transfer',?,?)",
      [
        .text(UUID().canonical), .text(id.canonical),
        .text(ResetGeneration.initial.resetID.canonical),
      ])
  }

  /// Calendar-aligned day ranges, at most 366 days. Running time is projected at the supplied clock.
  public func compactAnalytics(homeTimezone: String, asOfMS: Int64, range: PersonalDateRange)
    async throws -> CompactPersonalSnapshot
  {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().compact(
            timezone: homeTimezone, revision: derivedRevision(), asOfMS: asOfMS, range: range)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func sessionPage(
    homeTimezone: String, range: PersonalDateRange,
    cursor: PersonalSessionCursor? = nil, limit: Int = 50
  ) async throws -> PersonalSessionPage {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().sessions(
            timezone: homeTimezone, revision: derivedRevision(), range: range, cursor: cursor,
            limit: limit)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func historyPage(
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod,
    offset: Int, cursor: PersonalHistoryCursor? = nil, limit: Int = 120
  ) async throws -> CompactHistoryPage {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().history(
            timezone: homeTimezone, revision: derivedRevision(), asOfMS: asOfMS,
            period: period, offset: offset, cursor: cursor, limit: limit)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  // Test seam for deterministic reset/account/rebuild races; no alternate production data path.
  func setDerivedBuildObserver(_ observer: (@Sendable (Bool) async -> Void)?) {
    derivedBuildObserver = observer
  }

  private func cache() throws -> PersonalDerivedCache {
    if let derivedCache { return derivedCache }
    let cache = try PersonalDerivedCache(directory: derivedCacheDirectory)
    derivedCache = cache
    return cache
  }

  private func derivedRevision() throws -> DerivedRevision {
    guard
      let row = try database.rows("SELECT journal_id,revision,epoch FROM derived_state WHERE id=1")
        .first,
      let id = row["journal_id"].flatMap(UUID.init(uuidString:)),
      let revision = row["revision"].flatMap(Int64.init),
      let epoch = row["epoch"].flatMap(Int64.init)
    else { throw StoreError.invalidInput }
    return DerivedRevision(journalID: id, revision: revision, rebuildEpoch: epoch)
  }

  private func refreshDerivedCache(homeTimezone: String) async throws {
    enum Work: Sendable {
      case current
      case append(DerivedHeader, DerivedRevision, [TrackingEvent])
      case rebuild(DerivedInput)
    }
    let work: Work = try journalTransaction(write: false) {
      let revision = try derivedRevision()
      if let header = try cache().header(timezone: homeTimezone),
        header.journalID == revision.journalID
      {
        if header.revision == revision.revision { return .current }
        let gap = revision.revision - header.revision
        if header.rebuildEpoch == revision.rebuildEpoch, (1...2048).contains(gap) {
          let events: [TrackingEvent] = try database.rows(
            "SELECT e.payload_json FROM derived_changes c JOIN events e ON e.event_id=c.event_id WHERE c.revision>? AND c.revision<=? ORDER BY c.revision LIMIT 2048",
            [.integer(header.revision), .integer(revision.revision)]
          ).map { try decode($0["payload_json"]!) }
          if events.count == gap,
            events.allSatisfy({
              header.selection == nil || $0.deviceID == header.selection?.activeDeviceID
            })
          {
            return .append(header, revision, events)
          }
        }
      }
      return .rebuild(
        DerivedInput(
          revision: revision, generation: try generation(), events: try events(),
          interruptions: try interruptions(), transfers: try transferMarkersInTransaction(),
          deletions: try deletions()))
    }
    let directory = derivedCacheDirectory
    let observer = derivedBuildObserver
    switch work {
    case .current: return
    case .append(let header, let revision, let events):
      let task = Task.detached(priority: .userInitiated) {
        if let observer { await observer(false) }
        try Task.checkCancellation()
        _ = try PersonalDerivedCache(directory: directory).append(
          events: events, from: header, to: revision)
      }
      try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
    case .rebuild(let input):
      let task = Task.detached(priority: .userInitiated) {
        if let observer { await observer(true) }
        try Task.checkCancellation()
        try PersonalDerivedCache(directory: directory).rebuild(input, timezone: homeTimezone)
      }
      try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
    }
  }

  public func dailyLimitPreferences() throws -> DailyLimitPreferences {
    try journalTransaction(write: false) { try dailyLimitPreferencesInTransaction() }
  }

  /// Returns the request identifier to remove from UserNotifications when pending work is cancelled.
  /// Changing settings never checks the threshold immediately; only a later real local event may claim.
  public func setDailyLimitPreferences(_ preferences: DailyLimitPreferences) throws -> String? {
    try journalTransaction { try setDailyLimitPreferencesInTransaction(preferences) }
  }

  private func setDailyLimitPreferencesInTransaction(_ preferences: DailyLimitPreferences) throws
    -> String?
  {
    guard (1...1_000_000).contains(preferences.threshold) else { throw StoreError.invalidInput }
    guard preferences != (try dailyLimitPreferencesInTransaction()) else { return nil }
    let identifier = try currentDailyLimitClaim()?.notificationIdentifier
    try database.execute(
      "UPDATE daily_limit_preferences SET enabled=?,threshold=?,evaluated_device=?,evaluated_sequence=? WHERE id=1",
      [
        .integer(preferences.enabled ? 1 : 0), .integer(Int64(preferences.threshold)),
        .text(deviceID.canonical), .integer(try nextSequence() - 1),
      ])
    try cancelDailyLimitWorkInTransaction()
    return identifier
  }

  /// Evaluate only after a committed real observation. Repeated calls/retries cannot reopen a day.
  @discardableResult
  public func evaluateDailyLimit(afterEventID: UUID, homeTimezone: String, nowMS: Int64)
    async throws -> UUID?
  {
    try validateTime(nowMS)
    let range = try PersonalDateRange.trailingDays(1, throughMS: nowMS, homeTimezone: homeTimezone)
    try validateTime(range.endMS)
    for _ in 0..<3 {
      let snapshot = try await compactAnalytics(
        homeTimezone: homeTimezone, asOfMS: nowMS, range: range)
      let outcome: (matched: Bool, claim: UUID?) = try journalTransaction {
        let revision = try derivedRevision()
        guard snapshot.version.journalID == revision.journalID,
          snapshot.version.revision == revision.revision
        else { return (false, nil) }
        guard
          let payload = try database.rows(
            "SELECT payload_json FROM events WHERE event_id=? AND event_id NOT IN (SELECT entity_id FROM quarantines)",
            [.text(afterEventID.canonical)]
          ).first?["payload_json"]
        else { return (true, nil) }
        let event: TrackingEvent = try decode(payload)
        guard event.deviceID == deviceID, event.generation == snapshot.generation, !event.isTest
        else { return (true, nil) }
        let state = try database.rows(
          "SELECT evaluated_device,evaluated_sequence FROM daily_limit_preferences WHERE id=1"
        ).first!
        let baseline =
          state["evaluated_device"] == deviceID.canonical ? Int64(state["evaluated_sequence"]!)! : 0
        guard event.sequence > baseline else { return (true, nil) }
        try database.execute(
          "UPDATE daily_limit_preferences SET evaluated_device=?,evaluated_sequence=? WHERE id=1",
          [.text(deviceID.canonical), .integer(event.sequence)])
        let preferences = try dailyLimitPreferencesInTransaction()
        guard preferences.enabled,
          snapshot.selectedDeviceID == nil || snapshot.selectedDeviceID == deviceID,
          let day = snapshot.days.first, day.folds >= preferences.threshold
        else { return (true, nil) }
        if let current = try currentDailyLimitClaim(), nowMS < current.notBeforeMS {
          return (true, nil)
        }
        let claim = DailyLimitNotificationClaim(
          claimID: UUID(), createdAtMS: nowMS,
          dayStartMS: range.startMS, notBeforeMS: range.endMS, homeTimezone: homeTimezone,
          threshold: preferences.threshold, folds: day.folds)
        try database.execute(
          "INSERT INTO daily_limit_claim(id,claim_id,payload_json,state,lease_token,lease_until_ms,next_attempt_ms) VALUES (1,?,?,'pending',NULL,NULL,0) ON CONFLICT(id) DO UPDATE SET claim_id=excluded.claim_id,payload_json=excluded.payload_json,state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=0",
          [.text(claim.claimID.canonical), .text(try encode(claim))])
        return (true, claim.claimID)
      }
      if outcome.matched { return outcome.claim }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func dailyLimitNotificationIdentifier() throws -> String? {
    try journalTransaction(write: false) { try currentDailyLimitClaim()?.notificationIdentifier }
  }

  public func leaseDailyLimitNotification(nowMS: Int64) throws -> DailyLimitNotificationLease? {
    try validateTime(nowMS)
    return try journalTransaction {
      guard try dailyLimitPreferencesInTransaction().enabled,
        let claim = try currentDailyLimitClaim()
      else { return nil }
      guard nowMS < claim.notBeforeMS else {
        try database.execute(
          "UPDATE daily_limit_claim SET state='expired',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND state IN ('pending','leased')"
        )
        return nil
      }
      guard
        let row = try database.rows(
          "SELECT state,lease_until_ms,next_attempt_ms FROM daily_limit_claim WHERE id=1"
        ).first,
        Int64(row["next_attempt_ms"]!)! <= nowMS,
        row["state"] == "pending"
          || (row["state"] == "leased" && Int64(row["lease_until_ms"] ?? "0")! <= nowMS)
      else { return nil }
      let token = UUID()
      let expiration = min(
        claim.notBeforeMS, nowMS + min(60000, TrackingReducer.maximumInteger - nowMS))
      try database.execute(
        "UPDATE daily_limit_claim SET state='leased',lease_token=?,lease_until_ms=? WHERE id=1",
        [.text(token.canonical), .integer(expiration)])
      return DailyLimitNotificationLease(claim: claim, token: token)
    }
  }

  /// Recheck immediately before scheduling. Root's notification coordinator reconciles this stable
  /// identifier with pending/delivered OS requests before retrying a save whose acknowledgment was lost.
  public func validateDailyLimitNotificationLease(
    _ lease: DailyLimitNotificationLease, nowMS: Int64
  ) throws {
    try validateTime(nowMS)
    try journalTransaction(write: false) {
      guard try dailyLimitPreferencesInTransaction().enabled,
        nowMS < lease.claim.notBeforeMS,
        try !database.rows(
          "SELECT claim_id FROM daily_limit_claim WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=? AND lease_until_ms>?",
          [.text(lease.claim.claimID.canonical), .text(lease.token.canonical), .integer(nowMS)]
        ).isEmpty
      else { throw DailyLimitNotificationError.invalidLease }
    }
  }

  public func acknowledgeDailyLimitNotification(_ lease: DailyLimitNotificationLease) throws {
    try journalTransaction {
      try database.execute(
        "UPDATE daily_limit_claim SET state='acknowledged',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=?",
        [.text(lease.claim.claimID.canonical), .text(lease.token.canonical)])
    }
  }

  public func retryDailyLimitNotification(_ lease: DailyLimitNotificationLease, atMS: Int64) throws
  {
    try validateTime(atMS)
    try journalTransaction {
      try database.execute(
        "UPDATE daily_limit_claim SET state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=? WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=?",
        [.integer(atMS), .text(lease.claim.claimID.canonical), .text(lease.token.canonical)])
    }
  }

  private func dailyLimitPreferencesInTransaction() throws -> DailyLimitPreferences {
    guard
      let row = try database.rows(
        "SELECT enabled,threshold FROM daily_limit_preferences WHERE id=1"
      ).first,
      let threshold = row["threshold"].flatMap(Int.init)
    else { throw StoreError.invalidInput }
    return DailyLimitPreferences(enabled: row["enabled"] == "1", threshold: threshold)
  }
  private func currentDailyLimitClaim() throws -> DailyLimitNotificationClaim? {
    try database.rows("SELECT payload_json FROM daily_limit_claim WHERE id=1").first.map {
      try decode($0["payload_json"]!)
    }
  }
  private func cancelDailyLimitWorkInTransaction() throws {
    try database.execute(
      "UPDATE daily_limit_claim SET state='cancelled',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND state IN ('pending','leased')"
    )
  }

  public func summary() throws -> TrackingSummary {
    try journalTransaction(write: false) {
      try PersonalAnalytics.snapshot(
        events: events(), interruptions: interruptions(), generation: generation(),
        homeTimezone: "UTC", asOfMS: 0, range: PersonalDateRange(startMS: 0, endMS: 1),
        transferMarkers: transferMarkersInTransaction(), deletions: deletions()
      ).lifetime
    }
  }

  /// Snapshot under a read transaction, then perform calendar work without holding the database lock.
  /// This actor runs off MainActor; UI refreshes on committed changes rather than timer ticks.
  public func analytics(homeTimezone: String, asOfMS: Int64, range: PersonalDateRange) throws
    -> PersonalAnalyticsSnapshot
  {
    let input = try journalTransaction(write: false) {
      (
        try events(), try interruptions(), try generation(), try transferMarkersInTransaction(),
        try deletions()
      )
    }
    return try PersonalAnalytics.snapshot(
      events: input.0, interruptions: input.1, generation: input.2, homeTimezone: homeTimezone,
      asOfMS: asOfMS, range: range, transferMarkers: input.3, deletions: input.4)
  }

  public func history(
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod, offset: Int
  ) throws -> PersonalHistorySnapshot {
    let input = try journalTransaction(write: false) {
      (
        try events(), try interruptions(), try generation(), try transferMarkersInTransaction(),
        try deletions()
      )
    }
    return try PersonalHistory.snapshot(
      events: input.0, interruptions: input.1, generation: input.2, homeTimezone: homeTimezone,
      asOfMS: asOfMS, period: period, offset: offset, transferMarkers: input.3, deletions: input.4)
  }

  public func lastObservedAtMS() throws -> Int64? {
    try journalTransaction(write: false) {
      let row = try database.rows(
        "SELECT observed_at_ms FROM events WHERE device_id=? AND event_id NOT IN (SELECT entity_id FROM quarantines) ORDER BY sequence DESC LIMIT 1",
        [.text(deviceID.canonical)]
      ).first
      return row?["observed_at_ms"].flatMap(Int64.init)
    }
  }

  func captureExportSnapshot() throws -> TrackingExportSnapshot {
    try journalTransaction(write: false) {
      let excluded = Set(
        try database.rows("SELECT DISTINCT entity_id FROM quarantines").compactMap {
          $0["entity_id"].flatMap(UUID.init(uuidString:))
        })
      var uploads: [UUID: ExportUploadState] = [:]
      for row in try database.rows(
        "SELECT entity_id,state FROM work_outbox WHERE kind='competition_event'")
      {
        guard let raw = row["entity_id"], let id = UUID(uuidString: raw), let state = row["state"]
        else { throw StoreError.invalidInput }
        switch state {
        case "pending", "leased", "retry_wait": uploads[id] = .pending
        case "acknowledged": uploads[id] = .acknowledged
        case "quarantined", "permanently_rejected": uploads[id] = .rejected
        default: uploads[id] = .unknown
        }
      }
      return TrackingExportSnapshot(
        generation: try generation(), events: try events(includeQuarantined: true),
        interruptions: try interruptions(), transferMarkers: try transferMarkersInTransaction(),
        excludedEventIDs: excluded, uploadStates: uploads, deletions: try deletions())
    }
  }

  func validateExportGeneration(_ expected: ResetGeneration) throws {
    try journalTransaction(write: false) {
      guard try generation() == expected else { throw TrackingExportError.staleSnapshot }
    }
  }

  public func retainedEvents() throws -> [TrackingEvent] {
    try journalTransaction(write: false) { try events(includeQuarantined: true) }
  }

  /// Import never allocates a local sequence or creates public submission work.
  public func importEvent(_ event: TrackingEvent) throws {
    _ = try TrackingReducer.reduce(events: [event], generation: event.generation)
    try journalTransaction { try importEventInTransaction(event) }
  }

  private func importEventInTransaction(_ event: TrackingEvent) throws {
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
    try journalTransaction { try setCompetitionEpochInTransaction(epoch) }
  }

  private func setCompetitionEpochInTransaction(_ epoch: UUID?) throws {
    if try competitionEpoch() != epoch {
      try database.execute("DELETE FROM settings WHERE key='competition_upload_suspended'")
      try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    }
    try database.execute("DELETE FROM settings WHERE key='competition_epoch'")
    if let epoch {
      try database.execute(
        "DELETE FROM settings WHERE key='competition_upload_suspended' AND value='restricted'")
      try database.execute(
        "INSERT INTO settings(key,value) VALUES ('competition_epoch',?)", [.text(epoch.canonical)]
      )
    } else {
      try database.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset')")
    }
    if epoch == nil {
      try database.execute("DELETE FROM settings WHERE key='competition_transfer'")
    }
  }

  /// An authoritative /me response revoked this installation; retain a pending explicit handover.
  public func suspendCompetitionUpload() throws {
    try journalTransaction {
      try database.execute(
        "DELETE FROM settings WHERE key IN ('competition_epoch','competition_upload')")
      try database.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset')")
    }
  }

  public func currentCompetitionEpoch() throws -> UUID? {
    try journalTransaction(write: false) { try competitionEpoch() }
  }

  private func competitionEpoch() throws -> UUID? {
    try database.rows("SELECT value FROM settings WHERE key='competition_epoch'").first?["value"]
      .flatMap(UUID.init(uuidString:))
  }

  public func privateHistoryHealth() throws -> PrivateHistoryHealth {
    try journalTransaction(write: false) {
      let count =
        Int(try database.rows("SELECT COUNT(*) AS n FROM rejected_reset_ids").first?["n"] ?? "0")
        ?? 0
      let rejected =
        Int64(
          try database.rows(
            "SELECT value FROM settings WHERE key='highest_rejected_reset_revision'"
          ).first?["value"] ?? "0") ?? 0
      let highest = try highestResetRevision()
      let current = try generation()
      return PrivateHistoryHealth(
        conflictingResetCount: count,
        highestKnownResetRevision: highest,
        requiresAttention: count > 0 && current.revision <= rejected,
        canResetHistory: highest < TrackingReducer.maximumInteger)
    }
  }

  private func highestResetRevision() throws -> Int64 {
    let remembered =
      Int64(
        try database.rows("SELECT value FROM settings WHERE key='highest_reset_revision'").first?[
          "value"] ?? "0") ?? 0
    return max(remembered, try generation().revision)
  }

  private func rememberResetRevision(_ revision: Int64, rejected: Bool = false) throws {
    let key = rejected ? "highest_rejected_reset_revision" : "highest_reset_revision"
    try database.execute(
      "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)",
      [.text(key), .text(String(revision))])
  }

  public func reset(id: UUID = UUID(), nowMS: Int64) throws
    -> ResetGeneration
  {
    try validateTime(nowMS)
    return try journalTransaction {
      guard
        try database.rows(
          "SELECT reset_id FROM rejected_reset_ids WHERE reset_id=?", [.text(id.canonical)]
        ).isEmpty
      else { throw StoreError.identityConflict }
      if let row = try database.rows(
        "SELECT revision FROM reset_markers WHERE reset_id=?", [.text(id.canonical)]
      ).first,
        let revision = Int64(row["revision"]!)
      {
        return ResetGeneration(revision: revision, resetID: id)
      }
      let previousRevision = try highestResetRevision()
      guard
        previousRevision < TrackingReducer.maximumInteger && id != ResetGeneration.initial.resetID
      else { throw StoreError.invalidInput }
      let marker = ResetGeneration(revision: previousRevision + 1, resetID: id)
      try adoptReset(marker, nowMS: nowMS)
      try enqueue("mirror_reset", entity: id, generation: marker)
      return marker
    }
  }

  public func importReset(_ marker: ResetGeneration, createdAtMS: Int64) throws {
    try validateTime(createdAtMS)
    _ = try TrackingReducer.reduce(events: [], generation: marker)
    guard marker.revision > 0 else { throw StoreError.invalidInput }
    _ = try importMirrorBatch(
      [.reset(marker, createdAtMS: createdAtMS)], storeID: "direct-reset", checkpoint: nil)
  }

  public func importInterruption(_ marker: TrackingInterruption) throws {
    _ = try TrackingReducer.reduce(
      events: [], interruptions: [marker], generation: marker.generation)
    try journalTransaction { try importInterruptionInTransaction(marker) }
  }

  private func importInterruptionInTransaction(_ marker: TrackingInterruption) throws {
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

  public func leaseCompetitionUpload(nowMS: Int64) throws -> CompetitionUpload? {
    try validateTime(nowMS)
    return try journalTransaction {
      guard let epoch = try competitionEpoch() else { return nil }
      guard
        try database.rows("SELECT value FROM settings WHERE key='competition_upload_suspended'")
          .isEmpty
      else { return nil }
      let current = try generation()
      if let value = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"]
      {
        var pending: CompetitionUpload = try decode(value)
        if pending.epochID == epoch && pending.generation == current {
          guard pending.leaseUntilMS <= nowMS, pending.nextAttemptMS <= nowMS else { return nil }
          pending.leaseToken = UUID()
          pending.leaseUntilMS = nowMS + 60_000
          try saveCompetitionUpload(pending)
          return pending
        }
        try database.execute("DELETE FROM settings WHERE key='competition_upload'")
      }
      let resets = try database.rows(
        "SELECT work_id FROM work_outbox WHERE kind='competition_reset' AND generation_id=? AND state='pending' LIMIT 1",
        [.text(current.resetID.canonical)])
      if resets.isEmpty,
        let value = try database.rows(
          "SELECT value FROM settings WHERE key='competition_upload_not_before'"
        ).first?["value"],
        let notBefore = Int64(value), notBefore > nowMS
      {
        return nil
      }
      let operation = UUID()
      let body: Data
      let workIDs: [UUID]
      let eventIDs: [UUID]
      let isReset = !resets.isEmpty
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      if let reset = resets.first {
        struct Request: Encodable {
          let schemaVersion = 1
          let operationID: String
          let epochID: String
          let generation: ResetGeneration
          enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case operationID = "operation_id"
            case epochID = "epoch_id"
            case generation
          }
        }
        body = try encoder.encode(
          Request(operationID: operation.canonical, epochID: epoch.canonical, generation: current))
        workIDs = [UUID(uuidString: reset["work_id"]!)!]
        eventIDs = []
      } else {
        let rows = try database.rows(
          "SELECT w.work_id,e.payload_json FROM work_outbox w JOIN events e ON e.event_id=w.entity_id WHERE w.kind='competition_event' AND w.generation_id=? AND w.state='pending' ORDER BY e.sequence LIMIT 256",
          [.text(current.resetID.canonical)])
        var events: [TrackingEvent] = []
        var ids: [UUID] = []
        for row in rows {
          let event: TrackingEvent = try decode(row["payload_json"]!)
          let workID = UUID(uuidString: row["work_id"]!)!
          guard event.competitionEpochID == epoch, !event.isTest, event.deviceID == deviceID else {
            try database.execute(
              "UPDATE work_outbox SET state='superseded' WHERE work_id=?", [.text(workID.canonical)]
            )
            continue
          }
          events.append(event)
          ids.append(workID)
        }
        guard !events.isEmpty else { return nil }
        struct Request: Encodable {
          let schemaVersion = 1
          let operationID: String
          let epochID: String
          let events: [TrackingEvent]
          enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case operationID = "operation_id"
            case epochID = "epoch_id"
            case events
          }
        }
        body = try encoder.encode(
          Request(operationID: operation.canonical, epochID: epoch.canonical, events: events))
        workIDs = ids
        eventIDs = events.map(\.eventID)
      }
      guard body.count <= 256 * 1024 else { throw StoreError.invalidInput }
      let upload = CompetitionUpload(
        operationID: operation, epochID: epoch, generation: current,
        isReset: isReset, body: body, eventIDs: eventIDs, workIDs: workIDs,
        leaseToken: UUID(), leaseUntilMS: nowMS + 60_000, nextAttemptMS: nowMS)
      try saveCompetitionUpload(upload)
      try database.execute(
        "INSERT INTO settings(key,value) VALUES('competition_upload_not_before',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(String(nowMS + 60_000))])
      return upload
    }
  }

  public func acknowledgeCompetitionUpload(_ upload: CompetitionUpload, dispositions: [String])
    throws
  {
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      guard upload.isReset ? dispositions.isEmpty : dispositions.count == upload.workIDs.count,
        dispositions.allSatisfy({
          ["accepted", "duplicate", "quarantined", "rejected"].contains($0)
        })
      else { throw StoreError.invalidInput }
      for (index, workID) in upload.workIDs.enumerated() {
        try database.execute(
          "UPDATE work_outbox SET state=? WHERE work_id=?",
          [.text(upload.isReset ? "acknowledged" : dispositions[index]), .text(workID.canonical)])
      }
      try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    }
  }

  public func retryCompetitionUpload(_ upload: CompetitionUpload, atMS: Int64) throws {
    try validateTime(atMS)
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      var pending = upload
      pending.attempts = min((pending.attempts ?? 0) + 1, 20)
      pending.nextAttemptMS = atMS
      pending.leaseUntilMS = 0
      try saveCompetitionUpload(pending)
    }
  }

  /// Preserve personal events and the immutable operation while stopping a terminal
  /// public failure. A new confirmed enrollment or reset explicitly clears this fence.
  public func stopCompetitionUpload(_ upload: CompetitionUpload, reason: String) throws {
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      try database.execute(
        "INSERT INTO settings(key,value) VALUES('competition_upload_suspended',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(reason)])
    }
  }

  public func hasPendingCompetitionReset() throws -> Bool {
    try journalTransaction(write: false) {
      try !database.rows(
        "SELECT work_id FROM work_outbox WHERE kind='competition_reset' AND state='pending' LIMIT 1"
      ).isEmpty
    }
  }

  public func pendingCompetitionEventCount() throws -> Int {
    try journalTransaction(write: false) {
      Int(
        try database.rows(
          "SELECT COUNT(*) AS count FROM work_outbox WHERE kind='competition_event' AND state='pending'"
        ).first?["count"] ?? "0") ?? 0
    }
  }

  private func saveCompetitionUpload(_ upload: CompetitionUpload) throws {
    try database.execute(
      "INSERT INTO settings(key,value) VALUES('competition_upload',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [.text(try encode(upload))])
  }

  private func validCompetitionUpload(_ upload: CompetitionUpload) throws -> Bool {
    guard try generation() == upload.generation, try competitionEpoch() == upload.epochID,
      let value = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"]
    else { return false }
    let current: CompetitionUpload = try decode(value)
    return current.operationID == upload.operationID && current.leaseToken == upload.leaseToken
  }

  public func leaseMirrorWork(nowMS: Int64, limit: Int = 50) throws -> [MirrorLease] {
    guard (1...100).contains(limit), nowMS >= 0,
      nowMS <= TrackingReducer.maximumInteger - 60_000
    else { throw StoreError.invalidInput }
    return try journalTransaction {
      let rows = try database.rows(
        """
        SELECT work_id,kind,entity_id FROM work_outbox
        WHERE kind IN ('mirror_event','mirror_reset','mirror_interruption','mirror_transfer','mirror_deletion') AND next_attempt_ms<=?
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
        case "mirror_deletion":
          guard
            let payload = try database.rows(
              "SELECT payload_json FROM entry_deletions WHERE deletion_id=?", [.text(entity)]
            ).first?["payload_json"]
          else { throw StoreError.invalidInput }
          record = .deletion(try decode(payload))
        case "mirror_interruption":
          guard
            let payload = try database.rows(
              "SELECT payload_json FROM interruptions WHERE interruption_id=?", [.text(entity)]
            ).first?["payload_json"]
          else { throw StoreError.invalidInput }
          record = .interruption(try decode(payload))
        case "mirror_transfer":
          if try !database.rows(
            "SELECT transfer_id FROM rejected_transfer_ids WHERE transfer_id=?", [.text(entity)]
          ).isEmpty {
            guard let id = UUID(uuidString: entity) else { throw StoreError.invalidInput }
            record = .transferRejection(id)
            break
          }
          guard
            let payload = try database.rows(
              "SELECT payload_json FROM transfer_markers WHERE transfer_id=?", [.text(entity)]
            ).first?["payload_json"]
          else { throw StoreError.invalidInput }
          record = .transfer(try decode(payload))
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

  public func prepareMirror(storeID: String) throws {
    guard !storeID.isEmpty, storeID.utf8.count <= 200 else { throw StoreError.invalidInput }
    try journalTransaction {
      let previous = try database.rows("SELECT value FROM settings WHERE key='mirror_store_id'")
        .first?["value"]
      guard previous != storeID else { return }
      // Local mirror saves are not cloud acknowledgments. A replaced mirror must be rebuilt.
      try database.execute(
        "UPDATE work_outbox SET state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=0 WHERE kind IN ('mirror_event','mirror_reset','mirror_interruption','mirror_transfer','mirror_deletion')"
      )
      try database.execute(
        "INSERT INTO settings(key,value) VALUES ('mirror_store_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(storeID)])
    }
  }

  public func mirrorCheckpoint(storeID: String) throws -> Data? {
    try journalTransaction(write: false) {
      guard
        let token = try database.rows(
          "SELECT token FROM sync_checkpoints WHERE store_id=?", [.text(storeID)]
        ).first?["token"]
      else { return nil }
      guard let data = Data(base64Encoded: token) else { throw StoreError.invalidInput }
      return data
    }
  }

  /// Import and checkpoint commit together. Future-generation records wait durably for their reset marker.
  @discardableResult
  public func importMirrorBatch(_ records: [MirrorRecord], storeID: String, checkpoint: Data?)
    throws -> Int
  {
    guard !storeID.isEmpty, storeID.utf8.count <= 200, records.count <= 10_000 else {
      throw StoreError.invalidInput
    }
    for record in records { try validateMirrorRecord(record) }
    return try journalTransaction {
      let resetGroups = Dictionary(
        grouping: records.filter { if case .reset = $0 { true } else { false } }, by: \.logicalID)
      var validResets: [(ResetGeneration, Int64)] = []
      for (id, incoming) in resetGroups {
        for record in incoming {
          if case .reset(let marker, _) = record { try rememberResetRevision(marker.revision) }
        }
        var versions = incoming
        if let row = try database.rows(
          "SELECT revision,created_at_ms FROM reset_markers WHERE reset_id=?", [.text(id.canonical)]
        ).first,
          let revision = Int64(row["revision"]!), let time = Int64(row["created_at_ms"]!)
        {
          versions.append(
            .reset(ResetGeneration(revision: revision, resetID: id), createdAtMS: time))
        }
        let previouslyRejected = try !database.rows(
          "SELECT reset_id FROM rejected_reset_ids WHERE reset_id=?", [.text(id.canonical)]
        ).isEmpty
        if previouslyRejected || versions.contains(where: { $0 != versions[0] }) {
          try database.execute(
            "INSERT OR IGNORE INTO rejected_reset_ids VALUES (?)", [.text(id.canonical)])
          for record in versions {
            if case .reset(let marker, _) = record {
              try rememberResetRevision(marker.revision, rejected: true)
            }
            try quarantine(record)
          }
          continue
        }
        if case .reset(let marker, let time) = versions[0] { validResets.append((marker, time)) }
      }
      // A conflicting reset cannot undo an already applied tombstone. Retain that protection,
      // reject further versions of its ID, and allow unrelated valid history to progress.
      for (marker, time) in validResets.sorted(by: { $0.0 < $1.0 }) {
        try adoptReset(marker, nowMS: time)
      }
      let active = try generation()
      let queued: [MirrorRecord] = try database.rows(
        "SELECT payload_json FROM deferred_imports WHERE (generation_revision,generation_id)<=(?,?) OR generation_id IN (SELECT reset_id FROM rejected_reset_ids) LIMIT 500",
        [.integer(active.revision), .text(active.resetID.canonical)]
      ).map { try decode($0["payload_json"]!) }
      for record in queued + records {
        if case .reset = record { continue }
        if case .transferRejection(let id) = record {
          try rejectTransferInTransaction(id)
          continue
        }
        if case .transfer(let marker) = record {
          try importTransferInTransaction(marker)
          continue
        }
        guard let recordGeneration = record.generation else { throw StoreError.invalidInput }
        let current = try generation()
        if recordGeneration > current {
          let payload = try encode(record)
          let rejected = try !database.rows(
            "SELECT reset_id FROM rejected_reset_ids WHERE reset_id=?",
            [.text(recordGeneration.resetID.canonical)]
          ).isEmpty
          if rejected {
            try database.execute(
              "DELETE FROM deferred_imports WHERE payload_hash=?", [.text(digest(payload))])
            try quarantine(record, replicateBarrier: false)
            continue
          }
          try database.execute(
            "INSERT OR IGNORE INTO deferred_imports(payload_hash,payload_json,generation_revision,generation_id) VALUES (?,?,?,?)",
            [
              .text(digest(payload)), .text(payload), .integer(recordGeneration.revision),
              .text(recordGeneration.resetID.canonical),
            ])
          continue
        }
        let payload = try encode(record)
        try database.execute(
          "DELETE FROM deferred_imports WHERE payload_hash=?", [.text(digest(payload))])
        if recordGeneration < current { continue }
        do {
          switch record {
          case .event(let event): try importEventInTransaction(event)
          case .interruption(let marker): try importInterruptionInTransaction(marker)
          case .deletion(let marker): try importDeletionInTransaction(marker)
          case .reset, .transfer, .transferRejection: break
          }
        } catch StoreError.identityConflict {
          // Preserve both versions; neither wins by arrival order.
          if case .event(let event) = record {
            for row in try database.rows(
              "SELECT payload_json FROM events WHERE event_id=? OR (device_id=? AND sequence=?)",
              [
                .text(event.eventID.canonical), .text(event.deviceID.canonical),
                .integer(event.sequence),
              ])
            {
              let old: TrackingEvent = try decode(row["payload_json"]!)
              try quarantine(.event(old))
            }
          } else if case .interruption(let marker) = record {
            for row in try database.rows(
              "SELECT payload_json FROM interruptions WHERE interruption_id=?",
              [.text(marker.interruptionID.canonical)])
            {
              let old: TrackingInterruption = try decode(row["payload_json"]!)
              try quarantine(.interruption(old))
            }
          }
          try quarantine(record)
        }
      }
      if let checkpoint {
        try database.execute(
          "INSERT INTO sync_checkpoints(store_id,token) VALUES (?,?) ON CONFLICT(store_id) DO UPDATE SET token=excluded.token",
          [.text(storeID), .text(checkpoint.base64EncodedString())])
      }
      return queued.count
    }
  }

  /// Only the completed full-mirror scan may replace an expired cursor, including an empty mirror.
  func finishMirrorRecovery(storeID: String, checkpoint: Data?) throws {
    try journalTransaction {
      if let checkpoint {
        try database.execute(
          "INSERT INTO sync_checkpoints(store_id,token) VALUES (?,?) ON CONFLICT(store_id) DO UPDATE SET token=excluded.token",
          [.text(storeID), .text(checkpoint.base64EncodedString())])
      } else {
        try database.execute("DELETE FROM sync_checkpoints WHERE store_id=?", [.text(storeID)])
      }
    }
  }

  public func quarantinedRecordCount() throws -> Int {
    try journalTransaction(write: false) {
      Int(
        try database.rows(
          "SELECT (SELECT count(DISTINCT entity_id) FROM quarantines) + (SELECT count(*) FROM rejected_transfer_ids) AS n"
        ).first?["n"]
          ?? "0") ?? 0
    }
  }

  private func validateMirrorRecord(_ record: MirrorRecord) throws {
    switch record {
    case .deletion(let marker): try marker.validate()
    case .transferRejection: break
    case .transfer(let marker):
      _ = try PrivateTransferPolicy.winner([marker])
    case .event(let event):
      _ = try TrackingReducer.reduce(events: [event], generation: event.generation)
    case .interruption(let marker):
      _ = try TrackingReducer.reduce(
        events: [], interruptions: [marker], generation: marker.generation)
    case .reset(let generation, let time):
      _ = try TrackingReducer.reduce(events: [], generation: generation)
      try validateTime(time)
      guard generation.revision > 0 else { throw StoreError.invalidInput }
    }
  }

  private func quarantine(_ record: MirrorRecord, replicateBarrier: Bool = true) throws {
    let payload = try encode(record)
    let hash = digest(payload)
    guard
      try database.rows(
        "SELECT entity_id FROM quarantines WHERE entity_id=? AND payload_hash=?",
        [.text(record.logicalID.canonical), .text(hash)]
      ).isEmpty
    else { return }
    try database.execute(
      "INSERT INTO quarantines VALUES (?,?,?,'identity_conflict')",
      [.text(record.logicalID.canonical), .text(hash), .text(payload)])
    try database.execute(
      "DELETE FROM work_outbox WHERE entity_id=? AND kind='competition_event'",
      [.text(record.logicalID.canonical)])
    guard replicateBarrier else { return }
    let device: UUID
    let sequence: Int64
    let time: Int64
    switch record {
    case .event(let event):
      device = event.deviceID
      sequence = event.sequence - 1
      time = event.observedAtMS
    case .interruption(let marker):
      device = marker.deviceID
      sequence = marker.afterSequence
      time = marker.observedAtMS
    case .reset, .transfer, .transferRejection, .deletion: return
    }
    guard let recordGeneration = record.generation else { throw StoreError.invalidInput }
    let barrier = TrackingInterruption(
      interruptionID: UUID(), deviceID: device, generation: recordGeneration,
      afterSequence: sequence, reason: .trackingInterruption, observedAtMS: time)
    try database.execute(
      "INSERT INTO interruptions VALUES (?,?,?,?,?)",
      [
        .text(barrier.interruptionID.canonical), .text(device.canonical),
        .text(recordGeneration.resetID.canonical), .integer(sequence), .text(try encode(barrier)),
      ])
    try enqueue(
      "mirror_interruption", entity: barrier.interruptionID, generation: recordGeneration)
  }

  private func digest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func adoptReset(_ marker: ResetGeneration, nowMS: Int64) throws {
    try database.execute("DELETE FROM settings WHERE key='competition_upload_suspended'")
    try rememberResetRevision(marker.revision)
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
    exportPurgePending = true
    try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    try cancelDailyLimitWorkInTransaction()
    try database.execute("DELETE FROM events")
    try database.execute("DELETE FROM captured_observations")
    try database.execute("DELETE FROM interruptions")
    try database.execute("DELETE FROM entry_deletions")
    try database.execute("DELETE FROM setup_attempt")
    try database.execute("DELETE FROM quarantines")
    try database.execute(
      "DELETE FROM work_outbox WHERE kind NOT IN ('mirror_reset','mirror_transfer')")
    if try competitionEpoch() != nil {
      try enqueue("competition_reset", entity: marker.resetID, generation: marker)
    }
  }

  public func journalRevisionToken() throws -> String {
    try journalTransaction(write: false) {
      let version = try derivedRevision()
      return "\(version.journalID):\(version.revision)"
    }
  }

  public func deleteIncompleteEntry(
    _ target: SessionDeletionTarget, participantID: String?, nowMS: Int64
  ) throws -> TrackingDeletion {
    try validateTime(nowMS)
    return try journalTransaction {
      let existing = try deletions()
      if let old = existing.first(where: { $0.target == target }) { return old }
      guard target.generation == (try generation()) else { throw StoreError.staleGeneration }
      let all = try events()
      let reduced = try TrackingReducer.reduce(
        events: all, interruptions: interruptions(), generation: target.generation,
        deletions: existing)
      let matches = reduced.sessions.filter { target.matches($0) && $0.endMS == target.endMS }
      guard matches.count == 1, matches[0].completeness == .incomplete else {
        throw StoreError.invalidInput
      }
      let source = all.filter {
        $0.deviceID == target.deviceID && $0.generation == target.generation && !$0.isTest
      }.sorted { $0.sequence < $1.sequence }
      let openings = source.filter {
        $0.transition == .open && $0.observedAtMS == target.startMS
          && (target.openingEventID == nil || $0.eventID == target.openingEventID)
      }
      guard openings.count == 1, let opening = openings.first else { throw StoreError.invalidInput }
      var selected = [opening]
      if let end = target.endMS {
        guard let next = source.first(where: { $0.sequence > opening.sequence }),
          next.transition == .close, next.observedAtMS == end
        else { throw StoreError.invalidInput }
        selected.append(next)
      }
      let marker = TrackingDeletion(
        target: target, eventIDs: selected.map(\.eventID), createdAtMS: nowMS,
        participantID: nil, epochIDs: Array(Set(selected.compactMap(\.competitionEpochID))))
      try importDeletionInTransaction(marker)
      try enqueue("mirror_deletion", entity: marker.deletionID, generation: target.generation)
      return marker
    }
  }
  public func pendingEntryDeletions(participantID: String) throws -> [TrackingDeletion] {
    try journalTransaction(write: false) {
      try database.rows(
        "SELECT payload_json FROM entry_deletions WHERE public_state NOT IN ('acknowledged',?) ORDER BY deletion_id LIMIT 50",
        [.text("wrong_account:" + participantID)]
      )
      .map { try decode($0["payload_json"]!) as TrackingDeletion }
      .filter {
        ($0.participantID == nil || $0.participantID == participantID)
          && $0.target.generation == (try? generation())
      }
    }
  }
  public func deferEntryDeletionForDifferentAccount(
    _ marker: TrackingDeletion, participantID: String
  ) throws {
    try journalTransaction {
      try database.execute(
        "UPDATE entry_deletions SET public_state=? WHERE deletion_id=? AND payload_json=?",
        [
          .text("wrong_account:" + participantID), .text(marker.deletionID.canonical),
          .text(try encode(marker)),
        ])
    }
  }
  public func acknowledgeEntryDeletion(_ marker: TrackingDeletion) throws {
    try journalTransaction {
      try database.execute(
        "UPDATE entry_deletions SET public_state='acknowledged' WHERE deletion_id=? AND payload_json=?",
        [.text(marker.deletionID.canonical), .text(try encode(marker))])
    }
  }
  public func hasPendingEntryDeletions() throws -> Bool {
    try journalTransaction(write: false) {
      try !database.rows(
        "SELECT deletion_id FROM entry_deletions WHERE public_state<>'acknowledged' LIMIT 1"
      ).isEmpty
    }
  }
  public func entryDeletions() throws -> [TrackingDeletion] {
    try journalTransaction(write: false) { try deletions() }
  }
  private func deletions() throws -> [TrackingDeletion] {
    try database.rows(
      "SELECT payload_json FROM entry_deletions"
    ).map { try decode($0["payload_json"]!) }
  }
  private func importDeletionInTransaction(_ marker: TrackingDeletion) throws {
    try marker.validate()
    guard marker.target.generation == (try generation()) else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM entry_deletions WHERE deletion_id=?",
      [.text(marker.deletionID.canonical)]
    ).first {
      let old: TrackingDeletion = try decode(row["payload_json"]!)
      guard old == marker else { throw StoreError.identityConflict }
      return
    }
    try database.execute(
      "INSERT INTO entry_deletions(deletion_id,payload_json,public_state) VALUES (?,?,?)",
      [
        .text(marker.deletionID.canonical), .text(try encode(marker)),
        .text(marker.epochIDs.isEmpty ? "acknowledged" : "pending"),
      ])
    try cancelDailyLimitWorkInTransaction()
    exportPurgePending = true
  }

  private func journalTransaction<T>(write: Bool = true, _ operation: () throws -> T) throws -> T {
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

  private func events(includeQuarantined: Bool = false) throws -> [TrackingEvent] {
    try database.rows(
      includeQuarantined
        ? "SELECT payload_json FROM events ORDER BY device_id,sequence"
        : "SELECT payload_json FROM events WHERE event_id NOT IN (SELECT entity_id FROM quarantines) ORDER BY device_id,sequence"
    ).map {
      try decode($0["payload_json"]!)
    }
  }

  private func interruptions() throws -> [TrackingInterruption] {
    try database.rows(
      "SELECT payload_json FROM interruptions WHERE interruption_id NOT IN (SELECT entity_id FROM quarantines)"
    ).map {
      try decode($0["payload_json"]!)
    }
  }

  private func insert(_ event: TrackingEvent) throws {
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
