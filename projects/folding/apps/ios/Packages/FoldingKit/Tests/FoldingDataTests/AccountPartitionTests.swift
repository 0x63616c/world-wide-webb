import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func rootDirectory() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-partitions-\(UUID())")
}

private let accountA = PrivateAccountIdentity.iCloud(
  containerIdentifier: "iCloud.test", userRecordName: "account-A")
private let accountB = PrivateAccountIdentity.iCloud(
  containerIdentifier: "iCloud.test", userRecordName: "account-B")

@Test func switchingPartitionsFencesReadsWritesAndPreservesSeparateHistory() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let leaseA = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let first = try router.openJournal(lease: leaseA, installationID: installation)
  try await first.setCompetitionEpoch(UUID())
  _ = try await first.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  let pending = try router.suspend()
  #expect(try router.currentLease(installationID: installation) == nil)
  do {
    _ = try await first.summary()
    Issue.record("Inactive history readable")
  } catch PartitionError.inactive {}
  do {
    _ = try await first.record(
      Observation(generation: .initial, transition: .close, observedAtMS: 2, timezoneID: "UTC"),
      nowMS: 2)
    Issue.record("Inactive write succeeded")
  } catch PartitionError.inactive {}
  let leaseB = try router.activate(accountB, transition: pending, installationID: installation)
  let second = try router.openJournal(lease: leaseB, installationID: installation)
  #expect(leaseA.directory != leaseB.directory)
  #expect(try await second.summary().folds == 0)
  #expect(try await second.currentCompetitionEpoch() == nil)
  let returned = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let reopened = try router.openJournal(lease: returned, installationID: installation)
  #expect(try await reopened.summary().folds == 1)
  #expect(try await reopened.currentCompetitionEpoch() == nil)
  _ = try await reopened.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 5000, timezoneID: "UTC"),
    nowMS: 5000)
  #expect(try await reopened.summary().folds == 2)
  #expect(try await reopened.summary().cycles == 0)
  do {
    _ = try await first.summary()
    Issue.record("Old epoch regained access on account return")
  } catch PartitionError.inactive {}
}

@Test func supersededTransitionsAndRestartCannotReactivateOldAccount() throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let old = try router.suspend()
  let winner = try router.suspend()
  let reopened = AccountPartitionRouter(directory: root)
  #expect(try reopened.currentLease(installationID: installation) == nil)
  do {
    _ = try reopened.activate(accountA, transition: old, installationID: UUID())
    Issue.record("Superseded transition activated")
  } catch PartitionError.superseded {}
  let active = try reopened.activate(accountB, transition: winner, installationID: installation)
  #expect(try reopened.currentLease(installationID: installation)?.directory == active.directory)
  #expect(try reopened.currentLease(forVerified: accountA, installationID: installation) == nil)
}

@Test func verifiedSameAccountLaunchPreservesSessionAndSourceSequence() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let lease = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let first = try router.openJournal(lease: lease, installationID: installation)
  _ = try await first.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  let resumed = try #require(
    try router.currentLease(forVerified: accountA, installationID: installation))
  let second = try router.openJournal(lease: resumed, installationID: installation)
  let close = try await second.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 10, timezoneID: "UTC"),
    nowMS: 10)
  #expect(close.event.sequence == 2)
  #expect(try await second.summary().cycles == 1)
}

#if os(macOS)
  @Test func suspendedRouteFencesJournalAlreadyOpenInAnotherProcess() async throws {
    let root = rootDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let router = AccountPartitionRouter(directory: root)
    _ = try router.activate(
      accountA, transition: router.suspend(),
      installationID: UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!)
    var package = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 { package.deleteLastPathComponent() }
    let process = Process()
    process.executableURL = package.appendingPathComponent(".build/debug/FoldingJournalProbe")
    process.arguments = ["--partition-fence", root.path]
    try process.run()
    defer { if process.isRunning { process.terminate() } }
    let deadline = ContinuousClock.now + .seconds(5)
    while !FileManager.default.fileExists(atPath: root.appendingPathComponent("probe-ready").path) {
      guard process.isRunning, ContinuousClock.now < deadline else { throw PartitionError.busy }
      try await Task.sleep(for: .milliseconds(10))
    }
    _ = try router.suspend()
    try Data().write(to: root.appendingPathComponent("probe-resume"))
    while process.isRunning {
      guard ContinuousClock.now < deadline else { throw PartitionError.busy }
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(process.terminationStatus == 0)
  }
#endif

@Test func partitionSessionClosesOldMirrorAndReusesOnlyVerifiedAccount() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let session = PrivatePartitionSession(
    router: AccountPartitionRouter(directory: root), installationID: UUID(),
    cloudConnectivity: false)
  let first = try await session.reconcile(verified: accountA)
  _ = try await first.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  _ = try await session.synchronize(nowMS: 1)
  let same = try await session.reconcile(verified: accountA)
  #expect(first === same)
  try await session.invalidate()
  do {
    _ = try await first.summary()
    Issue.record("Invalidated session readable")
  } catch PartitionError.inactive {}
  let second = try await session.reconcile(verified: accountB)
  _ = try await session.synchronize(nowMS: 2)
  #expect(try await second.summary().folds == 0)
  let returned = try await session.reconcile(verified: accountA)
  _ = try await session.synchronize(nowMS: 3)
  #expect(try await returned.summary().folds == 1)
  try await session.invalidate()
}

@Test func restoredRouteRequiresAccountVerificationForNewInstallation() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let oldInstallation = UUID()
  let newInstallation = UUID()
  let old = try router.activate(
    accountA, transition: router.suspend(), installationID: oldInstallation)
  let journal = try router.openJournal(lease: old, installationID: oldInstallation)
  _ = try await journal.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  #expect(try router.currentLease(installationID: newInstallation) == nil)
  #expect(try router.currentLease(forVerified: accountA, installationID: newInstallation) == nil)
  do {
    _ = try router.openJournal(lease: old, installationID: newInstallation)
    Issue.record("Restored routing authority accepted")
  } catch PartitionError.inactive {}
  let restoredSession = PrivatePartitionSession(
    router: router, installationID: newInstallation, cloudConnectivity: false)
  // Only after account A is verified does reconciliation activate its preserved partition.
  let verified = try await restoredSession.reconcile(verified: accountA)
  #expect(try await verified.summary().folds == 1)
  do {
    _ = try await journal.summary()
    Issue.record("Old installation stayed active")
  } catch PartitionError.inactive {}
  try await restoredSession.invalidate()
}

@Test func simultaneousVerifiedAccountConnectionsShareTheOpeningJournal() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let session = PrivatePartitionSession(
    router: AccountPartitionRouter(directory: root), installationID: UUID(),
    cloudConnectivity: false)
  let outcomes = await withTaskGroup(of: Result<TrackingStore, Error>.self) { group in
    for _ in 0..<8 {
      group.addTask {
        do { return .success(try await session.reconcile(verified: accountA)) } catch {
          return .failure(error)
        }
      }
    }
    var results: [Result<TrackingStore, Error>] = []
    for await result in group { results.append(result) }
    return results
  }
  var opened: TrackingStore?
  for result in outcomes {
    switch result {
    case .success(let journal):
      if let opened { #expect(journal === opened) } else { opened = journal }
    case .failure(let error):
      let reported = error as NSError
      Issue.record("Concurrent account opening failed: \(reported.domain) error \(reported.code)")
    }
  }
  try await session.invalidate()
}

private actor FirstMirrorGate {
  private(set) var entered = false
  private var released = false
  private var continuation: CheckedContinuation<Void, Never>?

  func waitForFirstOpen() async {
    guard !entered else { return }
    entered = true
    guard !released else { return }
    await withCheckedContinuation { continuation = $0 }
  }
  func release() {
    released = true
    continuation?.resume()
    continuation = nil
  }
  func waitUntilEntered() async throws {
    let deadline = ContinuousClock.now + .seconds(5)
    while !entered {
      guard ContinuousClock.now < deadline else {
        release()
        throw PartitionError.busy
      }
      try await Task.sleep(for: .milliseconds(1))
    }
  }
}

@Test func invalidationCancelsSharedOpeningWithoutReplacingTheNewAccount() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let installation = UUID()
  let router = AccountPartitionRouter(directory: root)
  let gate = FirstMirrorGate()
  let session = PrivatePartitionSession(
    router: router, installationID: installation, cloudConnectivity: false,
    makeMirror: { directory, container in
      await gate.waitForFirstOpen()
      return try await PrivateCloudMirror(directory: directory, containerIdentifier: container)
    })
  let old = Task { try await session.reconcile(verified: accountA) }
  try await gate.waitUntilEntered()
  try await session.invalidate()
  let current = try await session.reconcile(verified: accountB)
  await gate.release()
  do {
    _ = try await old.value
    Issue.record("Invalidated opening returned an old-account journal")
  } catch is CancellationError {}
  #expect(try router.currentLease(forVerified: accountA, installationID: installation) == nil)
  #expect(try router.currentLease(forVerified: accountB, installationID: installation) != nil)
  #expect(try await session.reconcile(verified: accountB) === current)
  #expect(try await current.summary().folds == 0)
  try await session.invalidate()
}

@Test func concurrentDifferentAccountsNeverShareAnOpening() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let installation = UUID()
  let router = AccountPartitionRouter(directory: root)
  let gate = FirstMirrorGate()
  let session = PrivatePartitionSession(
    router: router, installationID: installation, cloudConnectivity: false,
    makeMirror: { directory, container in
      await gate.waitForFirstOpen()
      return try await PrivateCloudMirror(directory: directory, containerIdentifier: container)
    })
  let first = Task { try await session.reconcile(verified: accountA) }
  try await gate.waitUntilEntered()
  do {
    _ = try await session.reconcile(verified: accountB)
    Issue.record("Different accounts shared a pending opening")
  } catch PartitionError.busy {}
  await gate.release()
  _ = try await first.value
  #expect(try router.currentLease(forVerified: accountA, installationID: installation) != nil)
  #expect(try router.currentLease(forVerified: accountB, installationID: installation) == nil)
  try await session.invalidate()
}

@Test func offlineWitnessIsBoundToAccountInstallationAndLiveLease() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let lease = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let witness = Data("synthetic-device-account-A".utf8)
  try router.rememberOfflineAccess(lease: lease, identityToken: witness)
  let restarted = AccountPartitionRouter(directory: root)
  #expect(
    try restarted.offlineLease(
      installationID: installation, allowLocalOnly: false, matchesIdentity: { $0 == witness })
      == lease)
  #expect(
    try restarted.offlineLease(
      installationID: UUID(), allowLocalOnly: false, matchesIdentity: { $0 == witness }) == nil)
  do {
    _ = try restarted.offlineLease(
      installationID: installation, allowLocalOnly: false, matchesIdentity: { _ in false })
    Issue.record("Different account reused offline access")
  } catch PartitionError.identityChanged {}
  _ = try router.suspend()
  #expect(
    try restarted.offlineLease(
      installationID: installation, allowLocalOnly: false, matchesIdentity: { $0 == witness })
      == nil)
  do {
    try router.rememberOfflineAccess(lease: lease, identityToken: witness)
    Issue.record("Suspended writer installed a grant")
  } catch PartitionError.inactive {}
}

@Test func offlineJournalDoesNotStartMirrorAndCanAttachReplicationLater() async throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let session = PrivatePartitionSession(
    router: router, installationID: installation, cloudConnectivity: false)
  let journal = try await session.reconcile(verified: accountA, startMirror: false)
  let witness = Data("synthetic-device-account-A".utf8)
  try await session.rememberOfflineAccess(identityToken: witness)
  _ = try await journal.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  let lease = try #require(try router.currentLease(installationID: installation))
  #expect(
    !FileManager.default.fileExists(atPath: lease.directory.appendingPathComponent("mirror").path))
  let restarted = PrivatePartitionSession(
    router: router, installationID: installation, cloudConnectivity: false)
  let reopened = try #require(
    await restarted.resumeOffline(allowLocalOnly: false, matchesIdentity: { $0 == witness }))
  #expect(try await reopened.summary().folds == 1)
  #expect(try await restarted.synchronize(nowMS: 1000) == nil)
  let same = try await restarted.reconcile(verified: accountA)
  #expect(same === reopened)
  let report = try #require(await restarted.synchronize(nowMS: 1000))
  #expect(report.localMirrorSaves == 1)
  try await restarted.pauseSynchronization()
  #expect(try await reopened.summary().folds == 1)
  #expect(try await restarted.synchronize(nowMS: 2000) == nil)
  try await restarted.invalidate()
}

@Test func nilWitnessCannotAuthorizeCloudHistoryButLocalOnlyHistoryRemainsOffline() throws {
  let root = rootDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let cloud = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  try router.rememberOfflineAccess(lease: cloud, identityToken: nil)
  #expect(
    try router.offlineLease(
      installationID: installation, allowLocalOnly: true, matchesIdentity: { _ in false }) == nil)
  let local = try router.activate(
    .local(UUID()), transition: router.suspend(), installationID: installation)
  try router.rememberOfflineAccess(lease: local, identityToken: nil)
  #expect(
    try router.offlineLease(
      installationID: installation, allowLocalOnly: true, matchesIdentity: { _ in false }) == local)
  do {
    _ = try router.offlineLease(
      installationID: installation, allowLocalOnly: false, matchesIdentity: { _ in false })
    Issue.record("Cloud identity inherited anonymous local authorization")
  } catch PartitionError.identityChanged {}
}
