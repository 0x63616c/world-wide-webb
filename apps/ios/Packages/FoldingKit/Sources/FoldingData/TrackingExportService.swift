import FoldingDomain
import Foundation

/// Own one service per active journal. Call cleanupExpired on foreground launch and shareURL
/// immediately before presentation; call finish after share completion or cancellation.
public actor TrackingExportService {
  private let store: TrackingStore
  private let owner = UUID()
  private var jobs: [UUID: Task<Void, Error>] = [:]
  private var prepared: [UUID: PreparedTrackingExport] = [:]
  private var cancellationEpoch = UUID()
  private var cancellationDepth = 0
  private let beforeWriting: (@Sendable () async throws -> Void)?

  public init(store: TrackingStore) {
    self.store = store
    self.beforeWriting = nil
  }

  init(store: TrackingStore, beforeWriting: @escaping @Sendable () async throws -> Void) {
    self.store = store
    self.beforeWriting = beforeWriting
  }

  public func prepare(format: TrackingExportFormat, homeTimezone: String, nowMS: Int64) async throws
    -> PreparedTrackingExport
  {
    guard (0...TrackingReducer.maximumInteger).contains(nowMS) else {
      throw StoreError.invalidInput
    }
    guard cancellationDepth == 0 else { throw CancellationError() }
    let epoch = cancellationEpoch
    try Task.checkCancellation()
    try await cleanupExpired(nowMS: nowMS)
    let snapshot = try await store.captureExportSnapshot()
    guard epoch == cancellationEpoch, cancellationDepth == 0 else { throw CancellationError() }
    let ticket = PreparedTrackingExport(
      id: UUID(), format: format, generation: snapshot.generation,
      exportedAtMS: nowMS, owner: owner,
      directory: store.exportDirectory.appendingPathComponent(
        UUID().uuidString.lowercased(), isDirectory: true))
    let root = store.exportDirectory
    let beforeWriting = self.beforeWriting
    let job = Task.detached(priority: .userInitiated) {
      try Task.checkCancellation()
      do {
        try ExportFiles.prepare(root: root, ticket: ticket)
        try await beforeWriting?()
        try Task.checkCancellation()
        let document = try PersonalExport.document(
          events: snapshot.events, interruptions: snapshot.interruptions,
          generation: snapshot.generation, homeTimezone: homeTimezone, exportedAtMS: nowMS,
          uploadStates: snapshot.uploadStates, excludedEventIDs: snapshot.excludedEventIDs)
        try Task.checkCancellation()
        try ExportFiles.write(document: document, ticket: ticket)
      } catch {
        try? ExportFiles.purge(ticket.directory)
        throw error
      }
    }
    jobs[ticket.id] = job
    defer { jobs[ticket.id] = nil }
    do {
      try await withTaskCancellationHandler {
        try await job.value
      } onCancel: {
        job.cancel()
      }
      try Task.checkCancellation()
      guard epoch == cancellationEpoch else { throw CancellationError() }
      try await store.validateExportGeneration(ticket.generation)
      guard epoch == cancellationEpoch else { throw CancellationError() }
      prepared[ticket.id] = ticket
      return ticket
    } catch {
      try? ExportFiles.purge(ticket.directory)
      throw error
    }
  }

  public func shareURL(for ticket: PreparedTrackingExport) async throws -> URL {
    guard ticket.owner == owner, prepared[ticket.id] != nil else {
      throw TrackingExportError.wrongOwner
    }
    do {
      try await store.validateExportGeneration(ticket.generation)
      guard FileManager.default.fileExists(atPath: ticket.fileURL.path) else {
        throw TrackingExportError.missingFile
      }
      return ticket.fileURL
    } catch {
      try? ExportFiles.purge(ticket.directory)
      prepared[ticket.id] = nil
      throw error
    }
  }

  public func finish(_ ticket: PreparedTrackingExport) throws {
    guard ticket.owner == owner else { throw TrackingExportError.wrongOwner }
    jobs[ticket.id]?.cancel()
    try ExportFiles.purge(ticket.directory)
    prepared[ticket.id] = nil
  }

  /// Account/reset UI teardown should cancel work and dismiss any presented share sheet.
  public func cancelAll() async throws {
    cancellationEpoch = UUID()
    cancellationDepth += 1
    defer { cancellationDepth -= 1 }
    let pending = jobs.values.map { $0 }
    for job in pending { job.cancel() }
    for job in pending { _ = try? await job.value }
    jobs.removeAll()
    prepared.removeAll()
    try ExportFiles.purge(store.exportDirectory)
  }

  public func cleanupExpired(nowMS: Int64) async throws {
    guard (0...TrackingReducer.maximumInteger).contains(nowMS) else {
      throw StoreError.invalidInput
    }
    let generation = try await store.currentGeneration()
    try ExportFiles.clean(root: store.exportDirectory, nowMS: nowMS, generation: generation)
  }
}
