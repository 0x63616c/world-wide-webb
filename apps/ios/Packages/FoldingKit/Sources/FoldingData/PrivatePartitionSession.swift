import Foundation

/// App-process owner. Resolve the actual CloudKit account before reconciliation; on account-change
/// notification call invalidate immediately, before awaiting the next account lookup.
public actor PrivatePartitionSession {
  private let router: AccountPartitionRouter
  private let installationID: UUID
  typealias MirrorFactory = @Sendable (URL, String?) async throws -> PrivateCloudMirror
  private let makeMirror: MirrorFactory
  private let cloudConnectivity: Bool
  private var active: (lease: PartitionLease, journal: TrackingStore, sync: PrivateSyncCoordinator)?
  private var revision = UUID()
  private var opening:
    (id: UUID, account: PrivateAccountIdentity, task: Task<TrackingStore, Error>)?

  public init(router: AccountPartitionRouter, installationID: UUID, cloudConnectivity: Bool = true)
  {
    self.router = router
    self.installationID = installationID
    self.cloudConnectivity = cloudConnectivity
    makeMirror = { try await PrivateCloudMirror(directory: $0, containerIdentifier: $1) }
  }

  init(
    router: AccountPartitionRouter, installationID: UUID,
    cloudConnectivity: Bool, makeMirror: @escaping MirrorFactory
  ) {
    self.router = router
    self.installationID = installationID
    self.cloudConnectivity = cloudConnectivity
    self.makeMirror = makeMirror
  }

  public func invalidate() async throws {
    _ = try router.suspend()
    revision = UUID()
    opening?.task.cancel()
    opening = nil
    let old = active
    active = nil
    try await old?.sync.stop()
  }

  /// Reuses an unchanged account on ordinary launch; transitions never move files between accounts.
  public func reconcile(verified account: PrivateAccountIdentity) async throws -> TrackingStore {
    if let opening {
      guard opening.account == account else { throw PartitionError.busy }
      let journal = try await opening.task.value
      try Task.checkCancellation()
      return journal
    }
    let id = UUID()
    let expectedRevision = revision
    let task = Task { try await openVerifiedPartition(account, revision: expectedRevision) }
    opening = (id, account, task)
    defer { if opening?.id == id { opening = nil } }
    let journal = try await task.value
    try Task.checkCancellation()
    return journal
  }

  private func openVerifiedPartition(_ account: PrivateAccountIdentity, revision expected: UUID)
    async throws -> TrackingStore
  {
    try requireCurrent(expected)
    let matching = try router.currentLease(forVerified: account, installationID: installationID)
    if let matching, let active, active.lease == matching { return active.journal }
    let lease: PartitionLease
    if let matching {
      lease = matching
      let old = active
      active = nil
      try await old?.sync.stop()
      try requireCurrent(expected)
    } else {
      let transition = try router.suspend()
      let old = active
      active = nil
      try await old?.sync.stop()
      try requireCurrent(expected)
      lease = try router.activate(account, transition: transition, installationID: installationID)
    }
    let journal = try router.openJournal(lease: lease, installationID: installationID)
    let container: String?
    if cloudConnectivity, case .iCloud(let identifier, _) = account {
      container = identifier
    } else {
      container = nil
    }
    let mirror = try await makeMirror(lease.directory.appendingPathComponent("mirror"), container)
    do {
      // An account notification may have arrived while the persistent store was loading.
      try requireCurrent(expected)
      try lease.withActive {}
    } catch {
      try await mirror.close()
      throw error
    }
    active = (lease, journal, PrivateSyncCoordinator(journal: journal, mirror: mirror))
    return journal
  }

  private func requireCurrent(_ expected: UUID) throws {
    try Task.checkCancellation()
    guard revision == expected else { throw PartitionError.superseded }
  }

  public func synchronize(nowMS: Int64) async throws -> PrivateSyncReport? {
    guard let active else { throw PartitionError.inactive }
    return try await active.sync.synchronize(nowMS: nowMS)
  }
}
