import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

@Test func resetRecoveryUsesRejectedHighWaterRevisionWithoutUndoingTombstones() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-health-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let conflictID = UUID()
  let store = try TrackingStore(directory: root, installationID: identity)
  let first = ResetGeneration(revision: 9, resetID: conflictID)
  let conflicting = ResetGeneration(revision: 40, resetID: conflictID)
  try await store.importMirrorBatch(
    [.reset(first, createdAtMS: 1), .reset(conflicting, createdAtMS: 2)], storeID: "m",
    checkpoint: nil)
  let health = try await store.privateHistoryHealth()
  #expect(health.conflictingResetCount == 1)
  #expect(health.requiresAttention)
  #expect(health.canResetHistory)
  #expect(health.highestKnownResetRevision == 40)
  #expect(try await store.currentGeneration() == .initial)
  await #expect(throws: StoreError.identityConflict) {
    _ = try await store.reset(id: conflictID, nowMS: 3)
  }
  let recovery = try await store.reset(nowMS: 3)
  #expect(recovery.revision == 41)
  let reopened = try TrackingStore(directory: root, installationID: identity)
  let recovered = try await reopened.privateHistoryHealth()
  #expect(recovered.conflictingResetCount == 1)
  #expect(!recovered.requiresAttention)
  #expect(recovered.highestKnownResetRevision == 41)
  try await reopened.importMirrorBatch(
    [.reset(conflicting, createdAtMS: 2)], storeID: "m", checkpoint: nil)
  #expect(try await reopened.currentGeneration() == recovery)
  #expect(!((try await reopened.privateHistoryHealth()).requiresAttention))
  let later = ResetGeneration(revision: 90, resetID: conflictID)
  try await reopened.importMirrorBatch(
    [.reset(later, createdAtMS: 4)], storeID: "m", checkpoint: nil)
  #expect(try await reopened.privateHistoryHealth().requiresAttention)
  #expect(try await reopened.reset(nowMS: 5).revision == 91)
}

@Test func rejectedMaximumResetRevisionDisablesResetButKeepsExportAvailable() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-health-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let marker = ResetGeneration(revision: TrackingReducer.maximumInteger, resetID: UUID())
  try await store.importMirrorBatch(
    [.reset(marker, createdAtMS: 1), .reset(marker, createdAtMS: 2)], storeID: "m", checkpoint: nil)
  let health = try await store.privateHistoryHealth()
  #expect(health.requiresAttention)
  #expect(!health.canResetHistory)
  await #expect(throws: StoreError.invalidInput) { _ = try await store.reset(nowMS: 3) }
  let service = TrackingExportService(store: store)
  let export = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 3)
  #expect(try await service.shareURL(for: export).isFileURL)
  try await service.finish(export)
}

@Test func priorJournalSeedsResetHighWaterFromRetainedConflictEvidence() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-health-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let store = try TrackingStore(directory: root, installationID: identity)
  let marker = ResetGeneration(revision: 83, resetID: UUID())
  try await store.importMirrorBatch(
    [.reset(marker, createdAtMS: 1), .reset(marker, createdAtMS: 2)], storeID: "m", checkpoint: nil)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.execute(
    "DELETE FROM settings WHERE key IN ('highest_reset_revision','highest_rejected_reset_revision')"
  )
  let reopened = try TrackingStore(directory: root, installationID: identity)
  #expect(try await reopened.privateHistoryHealth().highestKnownResetRevision == 83)
  #expect(try await reopened.privateHistoryHealth().requiresAttention)
  #expect(try await reopened.reset(nowMS: 3).revision == 84)
}
