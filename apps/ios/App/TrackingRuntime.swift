import FoldingData
import FoldingDomain
import Foundation
import WidgetKit

/// Private tracking uses an account-fenced App Group journal. Development storage
/// is compiled only for the unconfigured Debug simulator composition.
actor TrackingRuntime {
  static let shared = TrackingRuntime()
  private let competitionUploader = CompetitionUploader()
  private var cloudConnection: CloudTrackingConnection?
  private var accountRevision = UUID()
  private var journal: TrackingStore?
  private var exportService: TrackingExportService?
  private var exportTickets: [UUID: PreparedTrackingExport] = [:]
  init(journal: TrackingStore? = nil) { self.journal = journal }

  private var privateSyncFailed = false
  private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

  func store() async throws -> TrackingStore {
    if let journal { return journal }
    if let configuration = try ProductionConfiguration.current() {
      let token = accountRevision
      if cloudConnection == nil {
        guard
          let shared = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: configuration.appGroup)
        else { throw CloudTrackingError.missingConfiguration }
        let root = shared.appendingPathComponent("FoldingPrivate", isDirectory: true)
        let installation = try InstallationIdentity.loadOrCreate(
          service: "\(configuration.bundleID).installation",
          accessGroup: nil, directory: root.appendingPathComponent("identity"))
        cloudConnection = CloudTrackingConnection(
          containerIdentifier: configuration.cloudContainer, root: root,
          installationID: installation)
      }
      let opened = try await cloudConnection!.connect()
      guard token == accountRevision else { throw PartitionError.superseded }
      journal = opened
      return opened
    }
    #if DEBUG && targetEnvironment(simulator)
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
    #else
      throw CloudTrackingError.missingConfiguration
    #endif
  }

  func accountChanged() async throws {
    accountRevision = UUID()
    journal = nil
    clearWidgets()
    try await cloudConnection?.invalidate()
    await DailyLimitDelivery.shared.cancelAll()
    try await cancelExports()
    exportService = nil
    changed()
    _ = try await store()
    await synchronizePrivateHistory()
  }

  func synchronizePrivateHistory() async {
    let revision = accountRevision
    do {
      _ = try await store()
      try await cloudConnection?.synchronize()
      guard revision == accountRevision else { return }
      privateSyncFailed = false
      await uploadCompetition()
      await configureDailyLimit()
      if let journal { await DailyLimitDelivery.shared.deliver(from: journal) }
      await publishWidgets()
      changed()
    } catch {
      if revision == accountRevision { privateSyncFailed = true }
      // A cloud outage never changes a committed local observation into a failure.
    }
  }

  func syncStatus(refresh: Bool) async throws -> TrackingSyncPresentation {
    if refresh { await synchronizePrivateHistory() }
    let store = try await store()
    let availability = await cloudConnection?.availability ?? .localOnly
    return TrackingSyncPresentation(
      iCloud: privateSyncFailed ? .unavailable : availability,
      publicTracking: try await store.currentCompetitionEpoch() != nil,
      pendingFolds: try await store.pendingCompetitionEventCount(),
      resetPending: try await store.hasPendingCompetitionReset())
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
    let store = try await store()
    let generation = try await store.currentGeneration()
    let epoch = try await store.currentCompetitionEpoch()
    let now = Self.nowMS
    let observation = Observation(
      generation: generation, transition: transition, observedAtMS: now,
      timezoneID: TimeZone.current.identifier, competitionEpochID: epoch)
    await configureDailyLimit()
    let receipt = try await store.record(observation, nowMS: now)
    if !receipt.wasRetry {
      let preferences = localPreferences()
      _ = try? await store.evaluateDailyLimit(
        afterEventID: receipt.event.eventID, homeTimezone: preferences.homeTimezone, nowMS: now)
    }
    await DailyLimitDelivery.shared.deliver(from: store)
    await uploadCompetition()
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
    let store = try await store()
    guard try await store.currentCompetitionEpoch() == nil else { throw StoreError.invalidInput }
    _ = try await store.selectTrackingDevice(store.deviceID, nowMS: Self.nowMS)
    await trackingPhoneChanged()
  }

  func trackingPhoneChanged() async {
    await publishWidgets()
    changed()
  }

  func reset() async throws {
    try await cancelExports()
    let current = try await store()
    let pending = try await current.dailyLimitNotificationIdentifier()
    _ = try await current.reset(nowMS: Self.nowMS)
    await DailyLimitDelivery.shared.cancel(pending)
    await uploadCompetition()
    clearWidgets()
    await publishWidgets()
    changed()
  }

  func maintainCompetitionUploads() async {
    while !Task.isCancelled {
      await uploadCompetition()
      do { try await Task.sleep(for: .seconds(15)) } catch { return }
    }
  }

  func uploadCompetition() async {
    do {
      let current = try await store()
      guard try await current.currentCompetitionEpoch() != nil,
        let text = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
        let origin = URL(string: text),
        let deployment = Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String
      else { return }
      let transport = try await CompetitionTransportPool.shared.client(
        origin: origin, deployment: deployment,
        deviceID: current.deviceID,
        bundleID: Bundle.main.bundleIdentifier ?? "app.getfolding.Folding")
      await competitionUploader.upload(from: current, transport: transport)
    } catch {}
  }

  private func localPreferences() -> FoldingPreferences {
    UserDefaults.standard.data(forKey: "folding.preferences.v1")
      .flatMap { try? JSONDecoder().decode(FoldingPreferences.self, from: $0) }
      ?? FoldingPreferences()
  }

  func configureDailyLimit() async {
    do {
      let enabled =
        UserDefaults.standard.data(forKey: "folding.notifications.v1")
        .flatMap { try? JSONDecoder().decode(NotificationPreferences.self, from: $0) }?.dailyLimit
        ?? false
      let current = try await store()
      let cancelled = try await current.setDailyLimitPreferences(
        DailyLimitPreferences(enabled: enabled, threshold: localPreferences().dailyLimit))
      await DailyLimitDelivery.shared.cancel(cancelled)
    } catch {}
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
      let store = try await store()
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

  private func exports() async throws -> TrackingExportService {
    if let exportService { return exportService }
    let service = TrackingExportService(store: try await store())
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
