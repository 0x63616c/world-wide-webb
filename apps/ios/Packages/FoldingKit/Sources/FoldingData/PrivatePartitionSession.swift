import Foundation

/// App-process owner. Resolve the actual CloudKit account before reconciliation; on account-change
/// notification call invalidate immediately, before awaiting the next account lookup.
public actor PrivatePartitionSession {
  private let router: AccountPartitionRouter
  private let installationID: UUID
  private let cloudConnectivity: Bool
  private var active: (lease: PartitionLease, journal: TrackingStore, sync: PrivateSyncCoordinator)?
  private var reconciling = false

  public init(router: AccountPartitionRouter, installationID: UUID, cloudConnectivity: Bool = true)
  {
    self.router = router
    self.installationID = installationID
    self.cloudConnectivity = cloudConnectivity
  }

  public func invalidate() async throws {
    _ = try router.suspend()
    let old = active
    active = nil
    try await old?.sync.stop()
  }

  /// Reuses an unchanged account on ordinary launch; transitions never move files between accounts.
  public func reconcile(verified account: PrivateAccountIdentity) async throws -> TrackingStore {
    guard !reconciling else { throw PartitionError.busy }
    reconciling = true
    defer { reconciling = false }
    let matching = try router.currentLease(forVerified: account, installationID: installationID)
    if let matching, let active, active.lease == matching { return active.journal }
    let lease: PartitionLease
    if let matching {
      lease = matching
      let old = active
      active = nil
      try await old?.sync.stop()
    } else {
      let transition = try router.suspend()
      let old = active
      active = nil
      try await old?.sync.stop()
      lease = try router.activate(account, transition: transition, installationID: installationID)
    }
    let journal = try router.openJournal(lease: lease, installationID: installationID)
    let container: String?
    if cloudConnectivity, case .iCloud(let identifier, _) = account {
      container = identifier
    } else {
      container = nil
    }
    let mirror = try await PrivateCloudMirror(
      directory: lease.directory.appendingPathComponent("mirror"), containerIdentifier: container)
    do {
      // An account notification may have arrived while the persistent store was loading.
      try lease.withActive {}
    } catch {
      try await mirror.close()
      throw error
    }
    active = (lease, journal, PrivateSyncCoordinator(journal: journal, mirror: mirror))
    return journal
  }

  public func synchronize(nowMS: Int64) async throws -> PrivateSyncReport? {
    guard let active else { throw PartitionError.inactive }
    return try await active.sync.synchronize(nowMS: nowMS)
  }
}
