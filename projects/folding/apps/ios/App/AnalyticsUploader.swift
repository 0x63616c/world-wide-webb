import BackgroundTasks
import Darwin
import FoldingData
import Foundation
import StoreKit

/// Anonymous usage analytics. The journal always queues fold history; this actor uploads it
/// while "Share usage data" is on and purges it while it is off. Nothing here carries names,
/// Apple Account, participant, competition or iCloud identifiers.
actor AnalyticsUploader {
  static let shared = AnalyticsUploader()
  static let refreshTaskIdentifier = "app.getfolding.Folding.analytics"

  private let session = URLSession(configuration: .ephemeral)
  private var running = false
  private var lastAttempt = Date.distantPast
  private var retryAfter = Date.distantPast
  private var failures = 0
  private var channel: String?

  /// Read on each use so a change in Settings applies to the next batch.
  nonisolated static var sharingEnabled: Bool {
    UserDefaults.standard.data(forKey: "folding.preferences.v1")
      .flatMap { try? JSONDecoder().decode(FoldingPreferences.self, from: $0) }?.shareUsageData
      ?? FoldingPreferences().shareUsageData
  }

  /// Records an app-usage event. Does nothing while sharing is off.
  nonisolated static func record(
    _ kind: String, detail: String? = nil, in journal: TrackingStore? = nil
  ) async {
    guard sharingEnabled else { return }
    let opened = try? await TrackingRuntime.shared.analyticsStore()
    guard let store = journal ?? opened else { return }
    try? await store.enqueueAnalytics(
      kind: kind, detail: detail.map(UsageAnalyticsEvent.detail), atMS: TrackingRuntime.nowMS,
      timezoneID: TimeZone.current.identifier)
  }

  /// Purges immediately; used when the person turns sharing off.
  func purge() async {
    try? await TrackingRuntime.shared.analyticsStore().purgeAnalytics()
  }

  /// Drains up to `maxBatches` batches unless a retry delay is pending.
  func upload(maxBatches: Int = 20) async {
    guard !running, Date.now >= retryAfter else { return }
    running = true
    defer { running = false }
    lastAttempt = .now
    guard let store = try? await TrackingRuntime.shared.analyticsStore() else { return }
    guard Self.sharingEnabled else {
      try? await store.purgeAnalytics()
      return
    }
    // The unsigned development simulator has no API origin.
    guard let configuration = try? ProductionConfiguration.current(),
      let analyticsID = try? Self.analyticsID()
    else { return }
    let context = await context(store)
    for _ in 0..<maxBatches {
      guard !Task.isCancelled, Self.sharingEnabled,
        let batch = try? await store.nextAnalyticsBatch(limit: 256)
      else { return }
      let (status, retryAfterSeconds) = await post(
        batch, analyticsID: analyticsID, context: context, origin: configuration.apiOrigin)
      if Task.isCancelled { return }
      let outcome = UsageAnalyticsUploadOutcome.decide(
        status: status, retryAfterSeconds: retryAfterSeconds, failures: failures + 1)
      switch outcome {
      case .acknowledge:
        failures = 0
        try? await store.acknowledgeAnalytics(throughSeq: batch.throughSeq)
      case .drop:
        // A batch the server will never accept must not wedge the queue.
        failures = 0
        try? await store.acknowledgeAnalytics(throughSeq: batch.throughSeq)
        await Self.record("error", detail: "upload.http_\(status ?? 0)")
      case .retry(let seconds):
        failures += 1
        retryAfter = .now.addingTimeInterval(TimeInterval(seconds))
        if failures == 1, let status { await Self.record("error", detail: "upload.http_\(status)") }
        return
      }
    }
  }

  /// After a Shortcuts recording: at most once a minute, and only for a few seconds.
  func uploadAfterRecording() async {
    guard Date.now.timeIntervalSince(lastAttempt) >= 60 else { return }
    lastAttempt = .now
    await withTaskGroup(of: Void.self) { group in
      group.addTask {
        await TrackingRuntime.shared.replayCapturedObservations()
        await self.upload(maxBatches: 2)
      }
      group.addTask { try? await Task.sleep(for: .seconds(3)) }
      await group.next()
      group.cancelAll()
    }
  }

  func backgroundRefresh() async {
    Self.scheduleRefresh()
    await upload()
  }

  nonisolated static func scheduleRefresh() {
    let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
    request.earliestBeginDate = .now.addingTimeInterval(6 * 3600)
    try? BGTaskScheduler.shared.submit(request)
  }

  private func post(
    _ batch: UsageAnalyticsBatch, analyticsID: String, context: Context, origin: URL
  ) async -> (Int?, Int?) {
    var request = URLRequest(url: origin.appending(path: "v1/analytics/batches"))
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
    request.setValue(String(context.build), forHTTPHeaderField: "X-Folding-Build")
    do {
      request.httpBody = try JSONEncoder().encode(
        Body(analyticsID: analyticsID, context: context, events: batch.events))
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { return (nil, nil) }
      return (
        http.statusCode, http.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) }
      )
    } catch {
      return (nil, nil)
    }
  }

  private func context(_ store: TrackingStore) async -> Context {
    let info = Bundle.main.infoDictionary ?? [:]
    let os = ProcessInfo.processInfo.operatingSystemVersion
    var machine = utsname()
    uname(&machine)
    let model = withUnsafeBytes(of: &machine.machine) { bytes in
      String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
    }
    return Context(
      appVersion: info["CFBundleShortVersionString"] as? String ?? "0",
      build: Int(info["CFBundleVersion"] as? String ?? "") ?? 0,
      channel: await channelName(),
      osVersion: os.patchVersion == 0
        ? "\(os.majorVersion).\(os.minorVersion)"
        : "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
      deviceModel: ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? model,
      region: Locale.current.region?.identifier,
      locale: String(Locale.current.identifier.prefix { $0 != "@" }),
      competition: (try? await store.currentCompetitionEpoch()) != nil)
  }

  private func channelName() async -> String {
    #if DEBUG
      return "debug"
    #else
      if let channel { return channel }
      let environment: AppStore.Environment?
      switch try? await AppTransaction.shared {
      case .verified(let transaction), .unverified(let transaction, _):
        environment = transaction.environment
      case nil: environment = nil
      }
      // Only a definite answer is cached; a failed lookup is retried on the next run.
      guard let environment else { return "app_store" }
      let name = environment == .production ? "app_store" : "testflight"
      channel = name
      return name
    #endif
  }

  /// A random device-only identifier, separate from the journal's installation ID.
  private static func analyticsID() throws -> String {
    let store = CompetitionCredentialStore(service: "app.getfolding.Folding.analytics")
    if let data = try store.read("analytics-id-v1"),
      let id = UUID(uuidString: String(decoding: data, as: UTF8.self))
    {
      return id.uuidString.lowercased()
    }
    let id = UUID().uuidString.lowercased()
    try store.write(Data(id.utf8), account: "analytics-id-v1")
    return id
  }

  struct Context: Encodable, Sendable {
    let appVersion: String
    let build: Int
    let channel: String
    let osVersion: String
    let deviceModel: String
    let region: String?
    let locale: String
    let competition: Bool

    enum CodingKeys: String, CodingKey {
      case appVersion = "app_version"
      case build, channel
      case osVersion = "os_version"
      case deviceModel = "device_model"
      case region, locale, competition
    }

    func encode(to encoder: Encoder) throws {
      var values = encoder.container(keyedBy: CodingKeys.self)
      try values.encode(appVersion, forKey: .appVersion)
      try values.encode(build, forKey: .build)
      try values.encode(channel, forKey: .channel)
      try values.encode(osVersion, forKey: .osVersion)
      try values.encode(deviceModel, forKey: .deviceModel)
      try values.encode(region, forKey: .region)  // null when unknown
      try values.encode(locale, forKey: .locale)
      try values.encode(competition, forKey: .competition)
    }
  }

  private struct Body: Encodable {
    let schemaVersion = 1
    let analyticsID: String
    let context: Context
    let events: [UsageAnalyticsEvent]
    enum CodingKeys: String, CodingKey {
      case schemaVersion = "schema_version"
      case analyticsID = "analytics_id"
      case context, events
    }
  }
}
