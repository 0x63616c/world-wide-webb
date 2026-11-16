import FoldingDomain
import Foundation

extension TrackingStore {
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
      var epochs = Set(selected.compactMap(\.competitionEpochID))
      if selected.contains(where: { $0.competitionEpochID == nil }),
        let epoch = try competitionEpoch(),
        try !database.rows("SELECT value FROM settings WHERE key='competition_history_before'")
          .isEmpty
      {
        epochs.insert(epoch)
      }
      let marker = TrackingDeletion(
        target: target, eventIDs: selected.map(\.eventID), createdAtMS: nowMS,
        participantID: nil, epochIDs: Array(epochs))
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
  func deletions() throws -> [TrackingDeletion] {
    try database.rows(
      "SELECT payload_json FROM entry_deletions"
    ).map { try decode($0["payload_json"]!) }
  }
  func importDeletionInTransaction(_ marker: TrackingDeletion) throws {
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
}
