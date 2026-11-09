import Foundation

/// App-process owner. Resolve the actual CloudKit account before reconciliation; on account-change
/// notification call invalidate immediately, before awaiting the next account lookup.
public actor PrivatePartitionSession {
  private let router: AccountPartitionRouter
  private let installationID: UUID
  typealias MirrorFactory = @Sendable (URL, String?) async throws -> PrivateCloudMirror
  private let makeMirror: MirrorFactory
  private let cloudConnectivity: Bool
  private var active:
    (lease: PartitionLease, journal: TrackingStore, sync: PrivateSyncCoordinator?)?
  private var revision = UUID()
  private var pausing = false
  private var opening:
    (
      id: UUID, account: PrivateAccountIdentity, startMirror: Bool, task: Task<TrackingStore, Error>
    )?

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
    try await old?.sync?.stop()
  }

  public func resumeOffline(
    allowLocalOnly: Bool, matchesIdentity: @Sendable (Data) -> Bool
  ) throws -> TrackingStore? {
    guard
      let lease = try router.offlineLease(
        installationID: installationID,
        allowLocalOnly: allowLocalOnly, matchesIdentity: matchesIdentity)
    else { return nil }
    if let active, active.lease == lease { return active.journal }
    guard active == nil else { throw PartitionError.inactive }
    let journal = try router.openJournal(lease: lease, installationID: installationID)
    active = (lease, journal, nil)
    return journal
  }

  public func rememberOfflineAccess(identityToken: Data?) throws {
    guard let active else { throw PartitionError.inactive }
    try router.rememberOfflineAccess(lease: active.lease, identityToken: identityToken)
  }

  /// Stop replication without fencing local history. Await in-flight mirror initialization.
  public func pauseSynchronization() async throws {
    guard !pausing else { return }
    pausing = true
    defer { pausing = false }
    let context = revision
    if let opening { _ = try? await opening.task.value }
    guard context == revision, let current = active else { return }
    active = (current.lease, current.journal, nil)
    try await current.sync?.stop()
  }

  /// Reuses an unchanged account on ordinary launch; transitions never move files between accounts.
  public func reconcile(verified account: PrivateAccountIdentity, startMirror: Bool = true)
    async throws -> TrackingStore
  {
    guard !pausing else { throw PartitionError.busy }
    if let opening {
      guard opening.account == account else { throw PartitionError.busy }
      let journal = try await opening.task.value
      try Task.checkCancellation()
      if startMirror, !opening.startMirror {
        if self.opening?.id == opening.id { self.opening = nil }
        return try await reconcile(verified: account, startMirror: true)
      }
      return journal
    }
    let id = UUID()
    let expectedRevision = revision
    let task = Task {
      try await openVerifiedPartition(account, revision: expectedRevision, startMirror: startMirror)
    }
    opening = (id, account, startMirror, task)
    defer { if opening?.id == id { opening = nil } }
    let journal = try await task.value
    try Task.checkCancellation()
    return journal
  }

  private func openVerifiedPartition(
    _ account: PrivateAccountIdentity, revision expected: UUID, startMirror: Bool
  )
    async throws -> TrackingStore
  {
    try requireCurrent(expected)
    let matching = try router.currentLease(forVerified: account, installationID: installationID)
    if let matching, let active, active.lease == matching, !startMirror || active.sync != nil {
      return active.journal
    }
    let lease: PartitionLease
    if let matching {
      lease = matching
      if active?.lease != matching {
        let old = active
        active = nil
        try await old?.sync?.stop()
        try requireCurrent(expected)
      }
    } else {
      let transition = try router.suspend()
      let old = active
      active = nil
      try await old?.sync?.stop()
      try requireCurrent(expected)
      lease = try router.activate(account, transition: transition, installationID: installationID)
    }
    let journal =
      try active?.journal ?? router.openJournal(lease: lease, installationID: installationID)
    active = (lease, journal, nil)
    guard startMirror else { return journal }
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
    return try await active.sync?.synchronize(nowMS: nowMS)
  }
}
