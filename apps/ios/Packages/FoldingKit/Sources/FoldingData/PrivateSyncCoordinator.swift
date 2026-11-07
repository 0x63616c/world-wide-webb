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
    // Adopt remote resets before writing local pending events into the mirror.
    for _ in 0..<10 {
      if stopped || Task.isCancelled { throw CancellationError() }
      let checkpoint = try await journal.mirrorCheckpoint(storeID: storeID)
      let batch = try await mirror.history(after: checkpoint)
      guard let next = batch.checkpoint else { break }
      try await journal.importMirrorBatch(batch.records, storeID: storeID, checkpoint: next)
      imported += batch.records.count
      if batch.transactionCount < 100 { break }
    }
    var saved = 0
    let leases = try await journal.leaseMirrorWork(nowMS: nowMS)
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

  /// Stop future work immediately; wait for any in-flight save before removing the account's mirror.
  public func stop() async throws {
    stopped = true
    while running {
      try? await Task.sleep(for: .milliseconds(10))
      await Task.yield()
    }
    try await mirror.close()
  }
}
