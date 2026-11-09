import FoldingData
import FoldingDomain
import Foundation
import WidgetKit

/// Private tracking uses an account-fenced App Group journal. Development storage
/// is compiled only for the unconfigured Debug simulator composition.
actor TrackingRuntime {
  static let shared = TrackingRuntime()
  private let competitionUploader = CompetitionUploader()
  private var uploadAttempt = CompetitionUploadAttempt.never
  private var observedLifecycle: TrackingDiagnosticEntry.Event?
  private var cloudConnection: CloudTrackingConnection?
  private var accountRevision = UUID()
  private var accountSuspended = false
  private var journal: TrackingStore?
  private var scheduledUpload: Task<Void, Never>?
  private let uploadOverride: (@Sendable () async -> Void)?
  private var exportService: TrackingExportService?
  private var exportTickets: [UUID: PreparedTrackingExport] = [:]
  init(
    journal: TrackingStore? = nil, cloudConnection: CloudTrackingConnection? = nil,
    uploadOverride: (@Sendable () async -> Void)? = nil
  ) {
    self.journal = journal
    self.cloudConnection = cloudConnection
    self.uploadOverride = uploadOverride
  }

  private var captureReplay: (id: UUID, task: Task<Void, Never>)?
  private var synchronizing = false
  private var privateSyncFailed = false
  private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

  func store() async throws -> TrackingStore {
    guard !accountSuspended else { throw PartitionError.superseded }
    let revision = accountRevision
    if let cloudConnection {
      let current = try await cloudConnection.connect()
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
      journal = current
      await replayCapturedObservations(in: current)
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
      return current
    }
    if let journal {
      await replayCapturedObservations(in: journal)
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
      return journal
    }
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
      await replayCapturedObservations(in: opened)
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
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
      await replayCapturedObservations(in: opened)
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
      return opened
    #else
      throw CloudTrackingError.missingConfiguration
    #endif
  }

  func hasMatchingLocalIdentity() async -> Bool {
    await cloudConnection?.hasMatchingLocalIdentity() ?? false
  }

  func suspendForAccountChange(revision: UUID) async throws {
    accountSuspended = true
    accountRevision = revision
    captureReplay?.task.cancel()
    captureReplay = nil
    journal = nil
    clearWidgets()
    try await cloudConnection?.invalidate()
    await DailyLimitDelivery.shared.cancelAll()
    try await cancelExports()
    exportService = nil
    changed()
  }

  func resumeAfterAccountChange(revision: UUID) async throws {
    guard accountRevision == revision else { throw PartitionError.superseded }
    accountSuspended = false
    _ = try await store()
    await synchronizePrivateHistory()
  }

  func synchronizePrivateHistory() async {
    guard !synchronizing else { return }
    synchronizing = true
    defer { synchronizing = false }
    let revision = accountRevision
    do {
      _ = try await store()
      await FoldingDiagnostics.record(journal, .syncStarted)
      try await cloudConnection?.synchronize()
      await FoldingDiagnostics.record(journal, .syncCompleted)
      guard revision == accountRevision else { return }
      privateSyncFailed = false
      await uploadCompetition()
      await configureDailyLimit()
      if let journal { await DailyLimitDelivery.shared.deliver(from: journal) }
      await publishWidgets()
      changed()
    } catch {
      if revision == accountRevision {
        privateSyncFailed = true
        await FoldingDiagnostics.record(journal, .syncFailed, error: error)
      }
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

  /// Recording success acknowledges a committed local capture, not network work.
  func record(_ transition: Transition) async throws {
    let id = UUID()
    let observedAt = Self.nowMS
    let timezone = TimeZone.current.identifier
    let revision = accountRevision
    for attempt in 0...2 {
      try Task.checkCancellation()
      guard revision == accountRevision, !accountSuspended else { throw PartitionError.superseded }
      do {
        let current = try await localCaptureStore()
        guard revision == accountRevision, !accountSuspended else {
          throw PartitionError.superseded
        }
        let captured = try await current.capture(
          transition, id: id, observedAtMS: observedAt,
          timezoneID: timezone, nowMS: Self.nowMS,
          dailyLimitPreferences: captureDailyLimitPreferences())
        changed()
        // This task is best effort. The inbox/leases are authoritative if the process
        // exits before processing starts or before acknowledgement completes.
        Task {
          guard revision == self.accountRevision, !self.accountSuspended else { return }
          await FoldingDiagnostics.record(current, .captureSaved, count: 1)
          await DailyLimitDelivery.shared.cancel(captured.cancelledNotificationIdentifier)
          guard revision == self.accountRevision, !self.accountSuspended else { return }
          await self.replayCapturedObservations(in: current)
        }
        return
      } catch PartitionError.busy where attempt < 2 {
        try await Task.sleep(for: .milliseconds(150 * (attempt + 1)))
      }
    }
  }

  /// Intents consume the app's durable account fence; they do not resolve CloudKit
  /// identity or load a replication mirror before saving an observation.
  private func localCaptureStore() async throws -> TrackingStore {
    guard !accountSuspended else { throw PartitionError.superseded }
    if let journal { return journal }
    if let configuration = try ProductionConfiguration.current() {
      guard
        let shared = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: configuration.appGroup)
      else { throw CloudTrackingError.missingConfiguration }
      let root = shared.appendingPathComponent("FoldingPrivate", isDirectory: true)
      let installation = try InstallationIdentity.loadOrCreate(
        service: "\(configuration.bundleID).installation",
        accessGroup: nil, directory: root.appendingPathComponent("identity"))
      let router = AccountPartitionRouter(directory: root)
      guard let lease = try router.currentLease(installationID: installation) else {
        throw PartitionError.inactive
      }
      return try router.openJournal(lease: lease, installationID: installation)
    }
    // Only the unconfigured Debug simulator can bootstrap local development storage.
    // A production phone without an active account fence must open the app first.
    return try await store()
  }

  private func captureDailyLimitPreferences() -> DailyLimitPreferences {
    let enabled =
      UserDefaults.standard.data(forKey: "folding.notifications.v1")
      .flatMap { try? JSONDecoder().decode(NotificationPreferences.self, from: $0) }?.dailyLimit
      ?? false
    return DailyLimitPreferences(enabled: enabled, threshold: localPreferences().dailyLimit)
  }

  func replayCapturedObservations() async {
    let revision = accountRevision
    guard let current = try? await localCaptureStore(), revision == accountRevision,
      !accountSuspended
    else { return }
    await replayCapturedObservations(in: current)
  }

  private func replayCapturedObservations(in current: TrackingStore) async {
    guard !accountSuspended else { return }
    if let replay = captureReplay {
      await replay.task.value
      return
    }
    let id = UUID()
    let task = Task { await self.processCapturedObservations(in: current) }
    captureReplay = (id, task)
    await task.value
    if captureReplay?.id == id { captureReplay = nil }
  }

  private func processCapturedObservations(in current: TrackingStore) async {
    let revision = accountRevision
    var committed = false
    var processed = 0
    let started = ProcessInfo.processInfo.systemUptime
    for _ in 0..<25 {
      guard !Task.isCancelled, revision == accountRevision, !accountSuspended else { break }
      let lease: CaptureLease
      do {
        guard let next = try await current.claimCapturedObservation(nowMS: Self.nowMS) else {
          break
        }
        lease = next
        if processed == 0 { await FoldingDiagnostics.record(current, .processingStarted) }
      } catch {
        await FoldingDiagnostics.record(current, .processingFailed, error: error)
        break
      }
      guard !Task.isCancelled, revision == accountRevision, !accountSuspended else { break }
      do {
        let receipt = try await current.commitCapturedObservation(lease, nowMS: Self.nowMS)
        guard revision == accountRevision, !accountSuspended else { break }
        // Re-evaluation is idempotent and must complete before removing this inbox row.
        _ = try await current.evaluateDailyLimit(
          afterEventID: receipt.event.eventID,
          homeTimezone: localPreferences().homeTimezone, nowMS: Self.nowMS)
        guard !Task.isCancelled, revision == accountRevision, !accountSuspended else { break }
        try await current.acknowledgeCapturedObservation(lease)
        committed = true
        processed += 1
      } catch CaptureError.invalidLease { break } catch {
        let permanent =
          error as? StoreError == .identityConflict || error as? StoreError == .invalidInput
        try? await current.retryCapturedObservation(lease, nowMS: Self.nowMS, quarantine: permanent)
        break
      }
    }
    if committed, revision == accountRevision, !accountSuspended {
      await FoldingDiagnostics.record(
        current, .processingCompleted, count: processed,
        durationMS: Int((ProcessInfo.processInfo.systemUptime - started) * 1000))
      await DailyLimitDelivery.shared.deliver(from: current)
      await scheduleCompetitionUpload(from: current)
      // Upload and iCloud outboxes were committed with each event. Existing workers
      // retry those independently; widgets remain best effort as specified.
      await publishWidgets(using: current)
      changed()
    }
  }

  func maintainCapturedObservations() async {
    while !Task.isCancelled {
      await replayCapturedObservations()
      do { try await Task.sleep(for: .seconds(2)) } catch { return }
    }
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
    await scheduleCompetitionUpload(from: current)
    clearWidgets()
    await publishWidgets()
    changed()
  }

  private func scheduleCompetitionUpload(from store: TrackingStore) async {
    guard (try? await store.currentCompetitionEpoch()) != nil, scheduledUpload == nil else {
      return
    }
    scheduledUpload = Task {
      await self.uploadCompetition()
      self.scheduledUpload = nil
    }
  }

  func maintainCompetitionUploads() async {
    while !Task.isCancelled {
      await uploadCompetition()
      do { try await Task.sleep(for: .seconds(15)) } catch { return }
    }
  }

  @discardableResult
  func uploadCompetition(using suppliedTransport: CompetitionTransport? = nil) async
    -> CompetitionUploadAttempt
  {
    uploadAttempt = .preparing
    if let uploadOverride {
      await uploadOverride()
      uploadAttempt = .idle
      return uploadAttempt
    }
    do {
      let current = try await store()
      guard try await current.currentCompetitionEpoch() != nil else {
        uploadAttempt = .notJoined
        return uploadAttempt
      }
      let transport: CompetitionTransport
      if let suppliedTransport {
        transport = suppliedTransport
      } else {
        guard let text = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
          let origin = URL(string: text),
          let deployment = Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String
        else {
          uploadAttempt = .unconfigured
          return uploadAttempt
        }
        transport = try await CompetitionTransportPool.shared.client(
          origin: origin, deployment: deployment,
          deviceID: current.deviceID,
          bundleID: Bundle.main.bundleIdentifier ?? "app.getfolding.Folding")
      }
      await FoldingDiagnostics.attach(to: transport, store: current)
      uploadAttempt = .running
      uploadAttempt = await competitionUploader.upload(from: current, transport: transport)
    } catch {
      uploadAttempt = .runtimeError
      await FoldingDiagnostics.record(journal, .uploadRuntimeFailed, error: error)
    }
    return uploadAttempt
  }

  func uploadDiagnostics() async -> (worker: String, queue: String) {
    let queue = (try? await journal?.competitionUploadQueueState(nowMS: Self.nowMS)) ?? .unreadable
    return (uploadAttempt.rawValue, queue.rawValue)
  }

  func diagnosticReport() async -> String {
    let availability = await cloudConnection?.availability ?? .localOnly
    var lines = [
      "Folding diagnostics",
      "environment=\(Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String ?? "development")",
      "lifecycle=\(observedLifecycle?.rawValue ?? "unknown")",
      "cloud_availability=\(String(describing: availability))",
      "version=\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"))",
      "os=\(ProcessInfo.processInfo.operatingSystemVersionString)",
      "locale=\(Locale.current.identifier)",
      "home_timezone=\(localPreferences().homeTimezone)",
      "worker=\(uploadAttempt.rawValue)",
      "account_suspended=\(accountSuspended)",
      "capture_processing=\(captureReplay != nil)",
      "scheduled_upload=\(scheduledUpload != nil)",
      "cloud_sync_running=\(synchronizing)",
      "cloud_sync_failed=\(privateSyncFailed)",
    ]
    do {
      // A support read must not wait for replay, network, widgets or notification delivery.
      let current = try await localCaptureStore()
      lines.append(try await current.diagnosticReport(nowMS: Self.nowMS))
    } catch {
      let failure = FoldingDiagnostics.errorInfo(error)
      lines.append("journal_error=\(failure.0.rawValue) detail=\(failure.1 ?? 0)")
    }
    return lines.joined(separator: "\n")
  }

  func recordLifecycle(_ event: TrackingDiagnosticEntry.Event) async {
    observedLifecycle = event
    await FoldingDiagnostics.record(journal, event)
  }

  func clearDiagnostics() async throws {
    try await localCaptureStore().clearDiagnostics()
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

  func publishWidgets(using suppliedStore: TrackingStore? = nil) async {
    do {
      let destination = try widgetStore()
      let preferences =
        UserDefaults.standard.data(forKey: "folding.preferences.v1")
        .flatMap { try? JSONDecoder().decode(FoldingPreferences.self, from: $0) }
        ?? FoldingPreferences()
      let store: TrackingStore
      if let suppliedStore { store = suppliedStore } else { store = try await self.store() }
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
          accent: "monochrome", setupComplete: setup.step == .complete))
      await FoldingDiagnostics.record(store, .widgetSnapshotWritten)
      WidgetCenter.shared.reloadAllTimelines()
    } catch {
      await FoldingDiagnostics.record(suppliedStore ?? journal, .widgetFailed, error: error)
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
