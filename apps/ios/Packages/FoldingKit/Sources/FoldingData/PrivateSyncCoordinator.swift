import CoreData
import Foundation

public struct PrivateSyncReport: Sendable {
  public let localMirrorSaves: Int
  public let importedRecords: Int
  public let quarantinedRecords: Int
}

/// One coordinator per account partition. UI/cloud-health observations remain separate from save receipts.
public actor PrivateSyncCoordinator {
  private let journal: TrackingStore
  private let mirror: PrivateCloudMirror
  private var running = false
  private var stopped = false
  private var recovery: MirrorRecoverySnapshot?

  public init(journal: TrackingStore, mirror: PrivateCloudMirror) {
    self.journal = journal
    self.mirror = mirror
  }

  /// Bounded foreground/background work; a later activation resumes remaining history/outbox work.
  public func synchronize(nowMS: Int64) async throws -> PrivateSyncReport? {
    guard !stopped else { throw MirrorError.closed }
    guard !running else { return nil }
    running = true
    defer { running = false }
    let storeID = mirror.storeID
    try await journal.prepareMirror(storeID: storeID)
    var imported = 0
    if recovery == nil, try await journal.mirrorCheckpoint(storeID: storeID) == nil {
      recovery = try await mirror.recoverySnapshot()
    }
    if recovery != nil { imported += try await recoverHistory(storeID: storeID) }
    // Adopt remote resets before writing local pending events into the mirror.
    for _ in 0..<10 where recovery == nil {
      if stopped || Task.isCancelled { throw CancellationError() }
      let checkpoint = try await journal.mirrorCheckpoint(storeID: storeID)
      let batch: MirrorHistoryBatch
      do {
        batch = try await mirror.history(after: checkpoint)
      } catch {
        let failure = error as NSError
        guard failure.domain == NSCocoaErrorDomain,
          failure.code == NSPersistentHistoryTokenExpiredError
        else { throw error }
        recovery = try await mirror.recoverySnapshot()
        imported += try await recoverHistory(storeID: storeID)
        break
      }
      guard let next = batch.checkpoint else { break }
      try await journal.importMirrorBatch(batch.records, storeID: storeID, checkpoint: next)
      imported += batch.records.count
      if batch.transactionCount < 100 { break }
    }
    // Drain eligible deferred records even without new history; never decode unrelated future rows.
    for _ in 0..<10 {
      if stopped || Task.isCancelled { throw CancellationError() }
      let drained = try await journal.importMirrorBatch([], storeID: storeID, checkpoint: nil)
      imported += drained
      if drained < 500 { break }
    }
    var saved = 0
    // Never export local work before the complete reset-tombstone scan has been imported.
    let leases = recovery == nil ? try await journal.leaseMirrorWork(nowMS: nowMS) : []
    for lease in leases {
      if stopped || Task.isCancelled { throw CancellationError() }
      do {
        try await mirror.save(lease.record)
        if stopped || Task.isCancelled { throw CancellationError() }
        try await journal.acknowledgeMirror(lease)
        saved += 1
      } catch {
        try await journal.retryMirror(lease, atMS: min(nowMS + 30_000, 9_007_199_254_740_991))
        throw error
      }
    }
    return PrivateSyncReport(
      localMirrorSaves: saved, importedRecords: imported,
      quarantinedRecords: try await journal.quarantinedRecordCount())
  }

  private func recoverHistory(storeID: String) async throws -> Int {
    guard let snapshot = recovery else { return 0 }
    var imported = 0
    do {
      for _ in 0..<10 {
        if stopped || Task.isCancelled { throw CancellationError() }
        guard let records = try await snapshot.next() else {
          try await journal.finishMirrorRecovery(storeID: storeID, checkpoint: snapshot.checkpoint)
          recovery = nil
          return imported
        }
        // Preserve the old checkpoint until every snapshot page has committed.
        try await journal.importMirrorBatch(records, storeID: storeID, checkpoint: nil)
        imported += records.count
      }
      return imported
    } catch {
      // A page may have been fetched but not committed. Restart, never skip it on retry.
      recovery = nil
      throw error
    }
  }

  /// Stop future work immediately; wait for any in-flight save before removing the account's mirror.
  public func stop() async throws {
    stopped = true
    while running {
      try? await Task.sleep(for: .milliseconds(10))
      await Task.yield()
    }
    recovery = nil
    try await mirror.close()
  }
}
