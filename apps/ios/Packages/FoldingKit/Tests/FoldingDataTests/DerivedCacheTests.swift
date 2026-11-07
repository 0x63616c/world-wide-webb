import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func cacheRoot() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-cache-\(UUID())")
}
private let cacheDay = PersonalDateRange(startMS: 0, endMS: 86_400_000)
private func cacheEvent(
  _ source: UUID, _ seq: Int64, transition: Transition? = nil,
  time: Int64? = nil, test: Bool = false, generation: ResetGeneration = .initial
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: seq, generation: generation,
    observedAtMS: time ?? seq * 1000, timezoneID: "UTC",
    transition: transition ?? (seq % 2 == 1 ? .open : .close), isTest: test, competitionEpochID: nil
  )
}
private actor CacheObserver {
  var builds: [Bool] = []
  var waiting: CheckedContinuation<Void, Never>?
  var block = false
  func observe(_ full: Bool) async {
    builds.append(full)
    if block {
      block = false
      await withCheckedContinuation { waiting = $0 }
    }
  }
  func pause() { block = true }
  func resume() {
    waiting?.resume()
    waiting = nil
  }
  func waitUntilPaused() async throws {
    let deadline = ContinuousClock.now + .seconds(5)
    while waiting == nil {
      guard ContinuousClock.now < deadline else { throw PersonalReadError.changedSnapshot }
      try await Task.sleep(for: .milliseconds(1))
    }
  }
}
private func assertCacheMatchesReplay(
  _ store: TrackingStore, zone: String = "UTC", now: Int64 = 900000,
  range: PersonalDateRange = cacheDay
) async throws {
  let cached = try await store.compactAnalytics(homeTimezone: zone, asOfMS: now, range: range)
  let replay = try await store.analytics(homeTimezone: zone, asOfMS: now, range: range)
  #expect(cached.lifetime == PersonalTotals(replay.lifetime))
  #expect(cached.days == replay.days)
  #expect(cached.runningSessions == replay.sessions.filter { $0.completeness == .running })
  #expect(cached.selectedDeviceID == replay.selectedDeviceID)
}

@Test func durableCacheRandomAppendBatchesMatchFullReplayAcrossRestart() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  var store = try TrackingStore(directory: root, installationID: source)
  let observer = CacheObserver()
  await store.setDerivedBuildObserver { await observer.observe($0) }
  try await assertCacheMatchesReplay(store)
  var random: UInt64 = 17
  for batch in 0..<20 {
    var records: [MirrorRecord] = []
    for index in 1...7 {
      let sequence = Int64(batch * 7 + index)
      random = random &* 6_364_136_223_846_793_005 &+ 1
      records.append(
        .event(
          cacheEvent(
            source, sequence,
            transition: random % 3 == 0 ? .close : .open,
            time: random % 5 == 0 ? sequence * 200 : sequence * 1000, test: random % 11 == 0)))
    }
    try await store.importMirrorBatch(records, storeID: "m", checkpoint: nil)
    try await assertCacheMatchesReplay(store)
    if batch == 9 {
      store = try TrackingStore(directory: root, installationID: source)
      await store.setDerivedBuildObserver { await observer.observe($0) }
      try await assertCacheMatchesReplay(store)
    }
  }
  #expect(await observer.builds == [true] + Array(repeating: false, count: 20))
}

@Test func cacheInvalidatesLateEventsInterruptionsSelectionResetAndTimezone() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let other = UUID()
  let store = try TrackingStore(directory: root, installationID: source)
  try await store.importEvent(cacheEvent(source, 3))
  try await assertCacheMatchesReplay(store)
  try await store.importEvent(cacheEvent(source, 1))
  try await store.importEvent(cacheEvent(source, 2))
  try await assertCacheMatchesReplay(store)
  try await store.importInterruption(
    TrackingInterruption(
      interruptionID: UUID(), deviceID: source,
      generation: .initial, afterSequence: 3, reason: .deviceRestart, observedAtMS: 3500))
  try await assertCacheMatchesReplay(store)
  try await store.importEvent(cacheEvent(other, 1))
  _ = try await store.selectTrackingDevice(other, nowMS: 4000)
  try await assertCacheMatchesReplay(store)
  try await store.importEvent(cacheEvent(source, 4))
  try await assertCacheMatchesReplay(store)
  let zone = "America/Los_Angeles"
  let range = try PersonalDateRange.trailingDays(1, throughMS: 900000, homeTimezone: zone)
  try await assertCacheMatchesReplay(store, zone: zone, range: range)
  _ = try await store.reset(nowMS: 5000)
  try await assertCacheMatchesReplay(store)
}

@Test func revisionBoundSessionAndHistoryPagesRejectChangedOrForeignSnapshots() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let store = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  try await store.importMirrorBatch(
    (1...12).map { .event(cacheEvent(source, Int64($0))) }, storeID: "m", checkpoint: nil)
  let first = try await store.sessionPage(homeTimezone: "UTC", range: cacheDay, limit: 2)
  #expect(first.sessions.count == 2)
  let cursor = try #require(first.nextCursor)
  let second = try await store.sessionPage(
    homeTimezone: "UTC", range: cacheDay, cursor: cursor, limit: 2)
  #expect(second.sessions.count == 2)
  #expect(!first.sessions.contains(second.sessions[0]))
  let history = try await store.historyPage(
    homeTimezone: "UTC", asOfMS: 20000, period: .day, offset: 0, limit: 3)
  #expect(history.bins.count == 3)
  #expect(history.nextBinOffset == 3)
  let next = try await store.historyPage(
    homeTimezone: "UTC", asOfMS: 20000, period: .day, offset: 0, cursor: history.nextCursor,
    limit: 3)
  #expect(next.bins.first?.startMS == history.bins.last?.endMS)
  try await store.importEvent(cacheEvent(source, 13))
  await #expect(throws: PersonalReadError.invalidCursor) {
    _ = try await store.sessionPage(homeTimezone: "UTC", range: cacheDay, cursor: cursor)
  }
  await #expect(throws: PersonalReadError.invalidCursor) {
    _ = try await store.historyPage(
      homeTimezone: "UTC", asOfMS: 20000, period: .day, offset: 0, cursor: history.nextCursor)
  }
  let foreign = try TrackingStore(
    directory: root.appendingPathComponent("b"), installationID: UUID())
  await #expect(throws: PersonalReadError.invalidCursor) {
    _ = try await foreign.sessionPage(homeTimezone: "UTC", range: cacheDay, cursor: cursor)
  }
}

@Test func cacheRebuildCannotPublishStaleSnapshotOverConcurrentJournalChanges() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let first = try TrackingStore(directory: root, installationID: source)
  let second = try TrackingStore(directory: root, installationID: source)
  let gate = CacheObserver()
  await gate.pause()
  await first.setDerivedBuildObserver { await gate.observe($0) }
  try await first.importEvent(cacheEvent(source, 1))
  let reading = Task {
    try await first.compactAnalytics(homeTimezone: "UTC", asOfMS: 3000, range: cacheDay)
  }
  try await gate.waitUntilPaused()
  try await second.importEvent(cacheEvent(source, 2))
  let newer = try await second.compactAnalytics(homeTimezone: "UTC", asOfMS: 3000, range: cacheDay)
  await gate.resume()
  let result = try await reading.value
  #expect(result.version == newer.version)
  #expect(result.lifetime.folds == 2)
  try await assertCacheMatchesReplay(first)
}

@Test func trimmedAppendLogFallsBackToFullDurableRebuild() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let store = try TrackingStore(directory: root, installationID: UUID())
  let observer = CacheObserver()
  await store.setDerivedBuildObserver { await observer.observe($0) }
  try await assertCacheMatchesReplay(store)
  try await store.importMirrorBatch(
    (1...2100).map { .event(cacheEvent(source, Int64($0))) }, storeID: "m", checkpoint: nil)
  try await assertCacheMatchesReplay(store)
  #expect(await observer.builds == [true, true])
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  #expect(Int(try db.rows("SELECT COUNT(*) AS n FROM derived_changes").first!["n"]!)! <= 2048)
}

@Test func inFlightCacheBuildFencesResetAndAccountSuspension() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let identity = UUID()
  let lease = try router.activate(
    .local(UUID()), transition: router.suspend(), installationID: identity)
  let store = try router.openJournal(lease: lease, installationID: identity)
  try await store.importEvent(cacheEvent(identity, 1))
  let gate = CacheObserver()
  await gate.pause()
  await store.setDerivedBuildObserver { await gate.observe($0) }
  let reading = Task {
    try await store.compactAnalytics(homeTimezone: "UTC", asOfMS: 3000, range: cacheDay)
  }
  try await gate.waitUntilPaused()
  let reset = try await store.reset(nowMS: 2000)
  await gate.resume()
  let result = try await reading.value
  #expect(result.generation == reset)
  #expect(result.lifetime.folds == 0)
  let next = cacheEvent(identity, 2, generation: reset)
  try await store.importEvent(next)
  await gate.pause()
  let stale = Task {
    try await store.compactAnalytics(homeTimezone: "UTC", asOfMS: 3000, range: cacheDay)
  }
  try await gate.waitUntilPaused()
  _ = try router.suspend()
  await gate.resume()
  await #expect(throws: PartitionError.inactive) { _ = try await stale.value }
}

@Test func cachedDSTHistoryAndConflictExclusionMatchPureProjection() async throws {
  let root = cacheRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let store = try TrackingStore(directory: root, installationID: UUID())
  let formatter = ISO8601DateFormatter()
  let start = Int64(formatter.date(from: "2026-11-01T07:30:00Z")!.timeIntervalSince1970 * 1000)
  let first = cacheEvent(identity, 1, time: start)
  let close = cacheEvent(identity, 2, time: start + 4 * 3_600_000)
  try await store.importMirrorBatch([.event(first), .event(close)], storeID: "m", checkpoint: nil)
  let zone = "America/Los_Angeles"
  let now = start + 6 * 3_600_000
  let range = try PersonalDateRange.trailingDays(1, throughMS: now, homeTimezone: zone)
  try await assertCacheMatchesReplay(store, zone: zone, now: now, range: range)
  let cached = try await store.historyPage(homeTimezone: zone, asOfMS: now, period: .day, offset: 0)
  let pure = try await store.history(homeTimezone: zone, asOfMS: now, period: .day, offset: 0)
  #expect(cached.bins == pure.bins)
  #expect(cached.bins.count == 25)
  let conflict = TrackingEvent(
    schemaVersion: 1, eventID: first.eventID, deviceID: identity, sequence: 1,
    generation: .initial, observedAtMS: start + 1, timezoneID: "UTC", transition: .open,
    isTest: false, competitionEpochID: nil)
  try await store.importMirrorBatch([.event(conflict)], storeID: "m", checkpoint: nil)
  try await assertCacheMatchesReplay(store, zone: zone, now: now, range: range)
}

#if os(macOS)
  private func runCacheProbe(_ arguments: [String]) throws -> String {
    var package = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 { package.deleteLastPathComponent() }
    let process = Process()
    let pipe = Pipe()
    process.executableURL = package.appendingPathComponent(".build/debug/FoldingJournalProbe")
    process.arguments = arguments
    process.standardOutput = pipe
    try process.run()
    let output = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    #expect(process.terminationStatus == 0)
    return String(decoding: output, as: UTF8.self)
  }
  @Test func hundredThousandEventDurableCacheFreshProcessAndAppendProfile() async throws {
    let root = cacheRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let identity = UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!
    let store = try TrackingStore(directory: root, installationID: identity)
    for start in stride(from: 1, through: 100000, by: 10000) {
      try await store.importMirrorBatch(
        (start..<(start + 10000)).map { .event(cacheEvent(identity, Int64($0))) }, storeID: "m",
        checkpoint: nil)
    }
    let range = PersonalDateRange(startMS: 0, endMS: 3 * 86_400_000)
    let buildStart = ContinuousClock.now
    let first = try await store.compactAnalytics(
      homeTimezone: "UTC", asOfMS: 200_000_000, range: range)
    #expect(first.lifetime.folds == 100000)
    let rebuildTime = buildStart.duration(to: .now)
    let freshProcess = try runCacheProbe(["--cached-read", root.path])
    #expect(freshProcess.hasPrefix("100000 "))
    // A real separate process commits an event; a live reader must observe durable invalidation.
    _ = try runCacheProbe([root.path, "1"])
    let observer = CacheObserver()
    await store.setDerivedBuildObserver { await observer.observe($0) }
    #expect(
      try await store.compactAnalytics(homeTimezone: "UTC", asOfMS: 200_000_000, range: range)
        .lifetime.folds == 100001)
    var samples: [Double] = []
    for index in 0..<20 {
      let start = ContinuousClock.now
      _ = try await store.record(
        Observation(
          generation: .initial, transition: index % 2 == 0 ? .close : .open,
          observedAtMS: 100_001_000 + Int64(index * 1000), timezoneID: "UTC"), nowMS: 200_000_000)
      _ = try await store.compactAnalytics(homeTimezone: "UTC", asOfMS: 200_000_000, range: range)
      let elapsed = start.duration(to: .now).components
      samples.append(Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18)
    }
    #expect(await observer.builds == Array(repeating: false, count: 21))
    print(
      "100k host cache: rebuild=\(rebuildTime), fresh process folds/seconds=\(freshProcess.trimmingCharacters(in: .whitespacesAndNewlines)), record+incremental-read p95=\(samples.sorted()[18])s. Not Duo device p95 evidence."
    )
  }
#endif
