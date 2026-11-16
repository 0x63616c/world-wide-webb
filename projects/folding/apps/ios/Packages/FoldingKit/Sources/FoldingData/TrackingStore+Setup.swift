import FoldingDomain
import Foundation

extension TrackingStore {
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
}
