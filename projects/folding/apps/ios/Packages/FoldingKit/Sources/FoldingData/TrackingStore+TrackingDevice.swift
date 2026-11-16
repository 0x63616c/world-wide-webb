import FoldingDomain
import Foundation

extension TrackingStore {
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

  func transferMarkersInTransaction() throws -> [PrivateTransferMarker] {
    try database.rows(
      "SELECT payload_json FROM transfer_markers WHERE transfer_id NOT IN (SELECT transfer_id FROM rejected_transfer_ids) ORDER BY revision,transfer_id"
    )
    .map { try decode($0["payload_json"]!) }
  }

  func importTransferInTransaction(_ marker: PrivateTransferMarker) throws {
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

  func rejectTransferInTransaction(_ id: UUID) throws {
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
}
