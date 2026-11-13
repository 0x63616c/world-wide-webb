import CloudKit
import FoldingData
import FoldingDomain
import Foundation
import XCTest

@testable import Folding

private final class OfflineIdentityProbe: CloudTrackingIdentitySource, @unchecked Sendable {
  let lock = NSLock()
  var offline = false
  var lookupCount = 0
  var token: String? = "synthetic-device-account-A"
  var accountName = "synthetic-account-A"
  var status: CKAccountStatus = .available
  func setOffline() { lock.withLock { offline = true } }
  func accountStatus() async throws -> CKAccountStatus {
    let offline = lock.withLock {
      lookupCount += 1
      return self.offline
    }
    if offline { throw URLError(.notConnectedToInternet) }
    return lock.withLock { status }
  }
  func userRecordName() async throws -> String { lock.withLock { accountName } }
  func localIdentityToken() -> LocalICloudIdentityToken? {
    lock.withLock { token.map { LocalICloudIdentityToken($0 as NSString) } }
  }
}
@MainActor final class OfflineColdStartTests: XCTestCase {
  func testHistoryAndTrackingReopenWithoutAnyCloudLookup() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let installation = UUID()
    let source = OfflineIdentityProbe()
    let first = CloudTrackingConnection(
      containerIdentifier: "iCloud.test", root: root, installationID: installation,
      identitySource: source, cloudConnectivity: false)
    let journal = try await first.connect()
    _ = try await journal.record(
      Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
      nowMS: 1000)
    let initialLookups = source.lock.withLock { source.lookupCount }
    source.setOffline()
    let restarted = CloudTrackingConnection(
      containerIdentifier: "iCloud.test", root: root, installationID: installation,
      identitySource: source, cloudConnectivity: false)
    let reopened = try await restarted.connect()
    let before = try await reopened.summary()
    XCTAssertEqual(before.folds, 1)
    _ = try await reopened.record(
      Observation(generation: .initial, transition: .close, observedAtMS: 2000, timezoneID: "UTC"),
      nowMS: 2000)
    let after = try await reopened.summary()
    XCTAssertEqual(after.folds, 2)
    XCTAssertEqual(source.lock.withLock { source.lookupCount }, initialLookups)
  }
}

private actor OfflineUploadGate {
  let started: XCTestExpectation
  private var continuation: CheckedContinuation<Void, Never>?
  init(_ started: XCTestExpectation) { self.started = started }
  func wait() async {
    await withCheckedContinuation { continuation in
      self.continuation = continuation
      started.fulfill()
    }
  }
  func release() {
    continuation?.resume()
    continuation = nil
  }
}
extension OfflineColdStartTests {
  func testChangedAccountAndSuspendedLeaseCannotReopenOldHistoryOffline() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let source = OfflineIdentityProbe()
    let installation = UUID()
    func connection(_ id: UUID? = nil) -> CloudTrackingConnection {
      CloudTrackingConnection(
        containerIdentifier: "iCloud.test", root: root, installationID: id ?? installation,
        identitySource: source, cloudConnectivity: false)
    }
    let first = connection()
    let old = try await first.connect()
    _ = try await old.record(
      Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
      nowMS: 1000)
    source.lock.withLock {
      source.token = "synthetic-device-account-B"
      source.offline = true
    }
    do {
      _ = try await connection().connect()
      XCTFail("Changed account reopened old data")
    } catch {}
    do {
      _ = try await old.summary()
      XCTFail("Old journal was not fenced")
    } catch PartitionError.inactive {}
    source.lock.withLock {
      source.token = "synthetic-device-account-A"
      source.offline = false
    }
    let recovered = try await connection().connect()
    let summary = try await recovered.summary()
    XCTAssertEqual(summary.folds, 1)
    source.setOffline()
    do {
      _ = try await connection(UUID()).connect()
      XCTFail("Different installation reused offline access")
    } catch {}
    _ = try AccountPartitionRouter(directory: root).suspend()
    do {
      _ = try await connection().connect()
      XCTFail("Suspended grant restored itself")
    } catch {}
  }
  func testTemporaryCloudOutageKeepsPersonalUIAndColdLocalOnlyAccess() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.offline.ui.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: root)
      defaults.removePersistentDomain(forName: suite)
    }
    let source = OfflineIdentityProbe()
    let installation = UUID()
    let connected = CloudTrackingConnection(
      containerIdentifier: "iCloud.test", root: root, installationID: installation,
      identitySource: source, cloudConnectivity: false, defaults: UserDefaults(suiteName: suite)!)
    _ = try await connected.connect()
    source.setOffline()
    let restarted = CloudTrackingConnection(
      containerIdentifier: "iCloud.test", root: root, installationID: installation,
      identitySource: source, cloudConnectivity: false, defaults: UserDefaults(suiteName: suite)!)
    let runtime = TrackingRuntime(cloudConnection: restarted)
    let controller = AppController(runtime: runtime, preferencesStore: defaults)
    try await runtime.record(.open)
    try await runtime.record(.close)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    await controller.cloudAccountChanged()  // availability notification, same local identity
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    let history = try await controller.actions.loadHistory!(.day, 0)
    XCTAssertEqual(history.folds, 2)
    source.lock.withLock {
      source.offline = false
      source.status = .temporarilyUnavailable
    }
    await controller.cloudAccountChanged()
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    source.lock.withLock { source.status = .available }
    await runtime.synchronizePrivateHistory()
    let after = try await runtime.store().summary()
    XCTAssertEqual(after.folds, 2)
    // A separate signed-out installation also retains local-only history on offline restart.
    let localRoot = root.appendingPathComponent("local-only")
    source.lock.withLock {
      source.token = nil
      source.status = .noAccount
    }
    let local = CloudTrackingConnection(
      containerIdentifier: "iCloud.localtest", root: localRoot, installationID: installation,
      identitySource: source, cloudConnectivity: false, defaults: UserDefaults(suiteName: suite)!)
    let journal = try await local.connect()
    _ = try await journal.record(
      Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
      nowMS: 1000)
    source.setOffline()
    let again = CloudTrackingConnection(
      containerIdentifier: "iCloud.localtest", root: localRoot, installationID: installation,
      identitySource: source, cloudConnectivity: false, defaults: UserDefaults(suiteName: suite)!)
    let localSummary = try await again.connect().summary()
    XCTAssertEqual(localSummary.folds, 1)
  }
  func testRecordingReturnsWhileUploadIsStillWaiting() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = try TrackingStore(directory: root, installationID: UUID())
    try await journal.setCompetitionEpoch(UUID())
    let started = expectation(description: "Upload started")
    let recorded = expectation(description: "Local recording returned")
    let gate = OfflineUploadGate(started)
    let runtime = TrackingRuntime(journal: journal, uploadOverride: { await gate.wait() })
    let record = Task {
      try await runtime.record(.open)
      recorded.fulfill()
    }
    await fulfillment(of: [started, recorded], timeout: 2)
    let summary = try await journal.summary()
    XCTAssertEqual(summary.folds, 1)
    await gate.release()
    try await record.value
  }
}
