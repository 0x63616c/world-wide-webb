import FoldingData
import FoldingDomain
import Foundation
import WidgetKit

/// Local development composition until Apple entitlements/account routing are configured.
/// Release remains compile-gated; this directory is never silently promoted to an iCloud account.
actor TrackingRuntime {
  static let shared = TrackingRuntime()
  private var journal: TrackingStore?
  private var exportService: TrackingExportService?
  private var exportTickets: [UUID: PreparedTrackingExport] = [:]
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
    await publishWidgets()
    changed()
  }

  func setup(_ action: SetupAction) async throws -> SetupProgress {
    let result = try await store().advanceSetup(action, nowMS: Self.nowMS)
    await publishWidgets()
    changed()
    return result
  }

  func useThisPhone() async throws {
    let store = try store()
    // Public enrollment must transfer online first; never silently replace its active device.
    guard try await store.currentCompetitionEpoch() == nil else { throw StoreError.invalidInput }
    _ = try await store.selectTrackingDevice(store.deviceID, nowMS: Self.nowMS)
    await publishWidgets()
    changed()
  }

  func reset() async throws {
    try await cancelExports()
    _ = try await store().reset(nowMS: Self.nowMS)
    clearWidgets()
    await publishWidgets()
    changed()
  }

  private func widgetStore() throws -> WidgetSnapshotStore {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "FoldingAppGroupIdentifier") as? String,
      !group.isEmpty
    else { throw WidgetSnapshotError.unavailable }
    return try WidgetSnapshotStore(groupIdentifier: group)
  }

  func clearWidgets() {
    try? widgetStore().clear()
    WidgetCenter.shared.reloadAllTimelines()
  }

  func publishWidgets() async {
    do {
      let destination = try widgetStore()
      let preferences =
        UserDefaults.standard.data(forKey: "folding.preferences.v1")
        .flatMap { try? JSONDecoder().decode(FoldingPreferences.self, from: $0) }
        ?? FoldingPreferences()
      let store = try store()
      let now = Self.nowMS
      let range = try PersonalDateRange.trailingDays(
        7, throughMS: now, homeTimezone: preferences.homeTimezone)
      let snapshot = try await store.compactAnalytics(
        homeTimezone: preferences.homeTimezone, asOfMS: now, range: range)
      let setup = try await store.setupProgress(nowMS: now)
      guard let today = snapshot.days.last,
        try await store.currentGeneration() == snapshot.generation
      else {
        clearWidgets()
        return
      }
      try destination.write(
        WidgetTrackingSnapshot(
          routeID: snapshot.version.journalID,
          generationRevision: snapshot.generation.revision,
          generationID: snapshot.generation.resetID,
          generatedAtMS: now, homeDayEndMS: today.endMS,
          folds: today.folds, unfoldedMS: today.completeDurationMS + today.runningDurationMS,
          dailyLimit: preferences.dailyLimit, trend: snapshot.days.map(\.folds),
          accent: preferences.accent.rawValue, setupComplete: setup.step == .complete))
      WidgetCenter.shared.reloadAllTimelines()
    } catch {
      // Widget maintenance must never make a committed observation report failure.
      clearWidgets()
    }
  }

  private func exports() throws -> TrackingExportService {
    if let exportService { return exportService }
    let service = TrackingExportService(store: try store())
    exportService = service
    return service
  }

  func prepareExport(_ format: TrackingExportFormat, homeTimezone: String) async throws -> UUID {
    let ticket = try await exports().prepare(
      format: format, homeTimezone: homeTimezone, nowMS: Self.nowMS)
    exportTickets[ticket.id] = ticket
    return ticket.id
  }

  func exportURL(_ id: UUID) async throws -> URL {
    guard let ticket = exportTickets[id] else { throw TrackingExportError.wrongOwner }
    return try await exports().shareURL(for: ticket)
  }

  func finishExport(_ id: UUID) async throws {
    guard let ticket = exportTickets.removeValue(forKey: id) else { return }
    try await exports().finish(ticket)
  }

  func cancelExports() async throws {
    exportTickets.removeAll()
    try await exportService?.cancelAll()
  }

  func cleanupExports() async throws {
    try await exports().cleanupExpired(nowMS: Self.nowMS)
  }

  nonisolated static var nowMS: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}
