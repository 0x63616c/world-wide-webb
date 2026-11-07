import CloudKit
import FoldingData
import Foundation

/// The app owns account transitions; the journal router fences stale process handles.
actor CloudTrackingConnection {
  private let container: CKContainer
  private let session: PrivatePartitionSession
  private let defaults: UserDefaults
  private let localKey: String
  private var revision = UUID()

  init(containerIdentifier: String, root: URL, installationID: UUID) {
    container = CKContainer(identifier: containerIdentifier)
    session = PrivatePartitionSession(
      router: AccountPartitionRouter(directory: root), installationID: installationID)
    defaults = .standard
    localKey = "folding.localAccount.\(containerIdentifier)"
  }

  func invalidate() async throws {
    revision = UUID()
    try await session.invalidate()
    // A sign-out/account signal starts a fresh local namespace, never the previous cloud partition.
    defaults.removeObject(forKey: localKey)
  }

  func connect() async throws -> TrackingStore {
    let token = revision
    let status = try await container.accountStatus()
    let identity: PrivateAccountIdentity
    switch status {
    case .available:
      let user = try await container.userRecordID()
      guard revision == token else { throw PartitionError.superseded }
      identity = .iCloud(
        containerIdentifier: container.containerIdentifier!, userRecordName: user.recordName)
    case .noAccount, .restricted:
      let id: UUID
      if let value = defaults.string(forKey: localKey), let saved = UUID(uuidString: value) {
        id = saved
      } else {
        id = UUID()
        defaults.set(id.uuidString, forKey: localKey)
      }
      identity = .local(id)
    case .couldNotDetermine, .temporarilyUnavailable:
      throw CloudTrackingError.accountUnavailable
    @unknown default:
      throw CloudTrackingError.accountUnavailable
    }
    guard revision == token else { throw PartitionError.superseded }
    return try await session.reconcile(verified: identity)
  }

  func synchronize() async throws {
    _ = try await session.synchronize(nowMS: Int64(Date().timeIntervalSince1970 * 1000))
  }
}

enum CloudTrackingError: Error { case accountUnavailable, missingConfiguration }
