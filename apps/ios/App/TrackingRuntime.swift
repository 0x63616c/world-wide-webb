import FoldingData
import FoldingDomain
import Foundation

/// Local development composition until Apple entitlements/account routing are configured.
/// Release remains compile-gated; this directory is never silently promoted to an iCloud account.
actor TrackingRuntime {
  static let shared = TrackingRuntime()
  private var journal: TrackingStore?
  init(journal: TrackingStore? = nil) { self.journal = journal }

  private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

  func store() throws -> TrackingStore {
    if let journal { return journal }
    let support = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let root = support.appendingPathComponent("FoldingDevelopment", isDirectory: true)
    let installation = try InstallationIdentity.loadOrCreate(
      service: "app.getfolding.Folding.installation", accessGroup: nil,
      directory: root.appendingPathComponent("identity"))
    let router = AccountPartitionRouter(directory: root)
    let lease: PartitionLease
    if let current = try router.currentLease(installationID: installation) {
      lease = current
    } else {
      lease = try router.activate(
        .local(UUID()), transition: router.suspend(), installationID: installation)
    }
    let opened = try router.openJournal(lease: lease, installationID: installation)
    journal = opened
    return opened
  }

  func updates() -> AsyncStream<Void> {
    let id = UUID()
    let pair = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    observers[id] = pair.continuation
    pair.continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
    pair.continuation.yield(())
    return pair.stream
  }

  private func removeObserver(_ id: UUID) { observers[id] = nil }
  private func changed() { for continuation in observers.values { continuation.yield(()) } }

  func record(_ transition: Transition) async throws {
    let store = try store()
    let generation = try await store.currentGeneration()
    let epoch = try await store.currentCompetitionEpoch()
    let now = Self.nowMS
    let observation = Observation(
      generation: generation, transition: transition, observedAtMS: now,
      timezoneID: TimeZone.current.identifier, competitionEpochID: epoch)
    _ = try await store.record(observation, nowMS: now)
    changed()
  }

  func setup(_ action: SetupAction) async throws -> SetupProgress {
    let result = try await store().advanceSetup(action, nowMS: Self.nowMS)
    changed()
    return result
  }

  func reset() async throws {
    _ = try await store().reset(nowMS: Self.nowMS)
    changed()
  }

  nonisolated static var nowMS: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}
