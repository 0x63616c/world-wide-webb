import CryptoKit
import FoldingDomain
import Foundation

extension TrackingStore {
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
      "DELETE FROM work_outbox WHERE entity_id=? AND kind IN ('competition_event','competition_history')",
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
}
