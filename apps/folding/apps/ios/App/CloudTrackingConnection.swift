import CloudKit
import FoldingData
import Foundation

struct LocalICloudIdentityToken: @unchecked Sendable {
  private let value: NSObject & NSCoding
  init(_ value: NSObject & NSCoding) { self.value = value }
  func archive() throws -> Data {
    try NSKeyedArchiver.archivedData(withRootObject: value, requiringSecureCoding: false)
  }
  func matches(_ data: Data) -> Bool {
    guard data.count <= 65_536,
      let decoder = try? NSKeyedUnarchiver(forReadingFrom: data)
    else { return false }
    decoder.requiresSecureCoding = false
    decoder.decodingFailurePolicy = .setErrorAndReturn
    defer { decoder.finishDecoding() }
    guard
      let old = decoder.decodeObject(of: [type(of: value)], forKey: NSKeyedArchiveRootObjectKey)
        as? NSObject
    else { return false }
    return value.isEqual(old)
  }
}

protocol CloudTrackingIdentitySource: Sendable {
  func accountStatus() async throws -> CKAccountStatus
  func userRecordName() async throws -> String
  func localIdentityToken() -> LocalICloudIdentityToken?
}
private struct SystemCloudTrackingIdentity: CloudTrackingIdentitySource {
  let container: CKContainer
  func accountStatus() async throws -> CKAccountStatus { try await container.accountStatus() }
  func userRecordName() async throws -> String { try await container.userRecordID().recordName }
  func localIdentityToken() -> LocalICloudIdentityToken? {
    (FileManager.default.ubiquityIdentityToken as? (NSObject & NSCoding)).map(
      LocalICloudIdentityToken.init)
  }
}

/// Local access is separate from cloud authorization. Only a matching device-account
/// witness can resume an existing cloud journal without another CloudKit round trip.
actor CloudTrackingConnection {
  private let identitySource: any CloudTrackingIdentitySource
  private let containerIdentifier: String
  private let session: PrivatePartitionSession
  private let defaults: UserDefaults
  private let localKey: String
  private var revision = UUID()
  private var invalidating = false
  private var synchronizing = false
  private var verification: (id: UUID, task: Task<(TrackingStore, PrivateAccountIdentity), Error>)?
  private(set) var availability: PrivateSyncAvailability = .checking

  init(
    containerIdentifier: String, root: URL, installationID: UUID,
    identitySource: (any CloudTrackingIdentitySource)? = nil,
    cloudConnectivity: Bool = true, defaults: UserDefaults = .standard
  ) {
    self.containerIdentifier = containerIdentifier
    self.identitySource =
      identitySource
      ?? SystemCloudTrackingIdentity(container: CKContainer(identifier: containerIdentifier))
    session = PrivatePartitionSession(
      router: AccountPartitionRouter(directory: root),
      installationID: installationID, cloudConnectivity: cloudConnectivity)
    self.defaults = defaults
    localKey = "folding.localAccount.\(containerIdentifier)"
  }

  func invalidate() async throws {
    guard !invalidating else { return }
    invalidating = true
    defer { invalidating = false }
    revision = UUID()
    verification?.task.cancel()
    verification = nil
    availability = .checking
    try await session.invalidate()
    defaults.removeObject(forKey: localKey)
  }

  func connect() async throws -> TrackingStore {
    guard !invalidating else { throw PartitionError.busy }
    let context = revision
    let witness = identitySource.localIdentityToken()
    do {
      if let journal = try await session.resumeOffline(
        allowLocalOnly: witness == nil,
        matchesIdentity: { witness?.matches($0) ?? false })
      {
        guard revision == context else { throw PartitionError.superseded }
        return journal
      }
    } catch PartitionError.identityChanged {
      // Fence old writers before any network lookup, including after a missed notification.
      try await invalidate()
    }
    return try await verifiedConnection().0
  }

  private func verifiedConnection() async throws -> (TrackingStore, PrivateAccountIdentity) {
    if let verification { return try await verification.task.value }
    let id = UUID()
    let context = revision
    let task = Task { try await self.resolveAccount(context: context) }
    verification = (id, task)
    defer { if verification?.id == id { verification = nil } }
    do { return try await task.value } catch {
      if revision == context {
        if error as? PartitionError == .identityChanged { try await invalidate() }
        availability = .unavailable
      }
      throw error
    }
  }

  private func resolveAccount(context: UUID) async throws -> (TrackingStore, PrivateAccountIdentity)
  {
    let before = identitySource.localIdentityToken()
    let status = try await identitySource.accountStatus()
    guard revision == context, !Task.isCancelled else { throw PartitionError.superseded }
    let identity: PrivateAccountIdentity
    let resolvedAvailability: PrivateSyncAvailability
    switch status {
    case .available:
      let name = try await identitySource.userRecordName()
      identity = .iCloud(containerIdentifier: containerIdentifier, userRecordName: name)
      resolvedAvailability = .available
    case .noAccount, .restricted:
      let id = defaults.string(forKey: localKey).flatMap(UUID.init(uuidString:)) ?? UUID()
      defaults.set(id.uuidString, forKey: localKey)
      identity = .local(id)
      resolvedAvailability = .localOnly
    case .couldNotDetermine, .temporarilyUnavailable:
      throw CloudTrackingError.accountUnavailable
    @unknown default:
      throw CloudTrackingError.accountUnavailable
    }
    let after = identitySource.localIdentityToken()
    let unchanged: Bool
    if let before, let after {
      unchanged = after.matches(try before.archive())
    } else {
      unchanged = before == nil && after == nil
    }
    guard unchanged else { throw PartitionError.identityChanged }
    guard revision == context, !Task.isCancelled else { throw PartitionError.superseded }
    // Opening the authoritative journal never waits for Core Data/CloudKit initialization.
    let journal = try await session.reconcile(verified: identity, startMirror: false)
    guard revision == context, !Task.isCancelled else { throw PartitionError.superseded }
    try await session.rememberOfflineAccess(identityToken: try after?.archive())
    availability = resolvedAvailability
    return (journal, identity)
  }

  func hasMatchingLocalIdentity() async -> Bool {
    guard !invalidating else { return false }
    let witness = identitySource.localIdentityToken()
    return
      (try? await session.resumeOffline(
        allowLocalOnly: witness == nil,
        matchesIdentity: { witness?.matches($0) ?? false })) != nil
  }

  func synchronize() async throws {
    guard !synchronizing, !invalidating else { return }
    synchronizing = true
    defer { synchronizing = false }
    var context = revision
    do {
      _ = try await connect()
      context = revision
      let (_, identity) = try await verifiedConnection()
      guard context == revision else { throw PartitionError.superseded }
      _ = try await session.reconcile(verified: identity, startMirror: true)
      guard context == revision else { throw PartitionError.superseded }
      _ = try await session.synchronize(nowMS: Int64(Date().timeIntervalSince1970 * 1000))
    } catch {
      if context == revision {
        availability = .unavailable
        try? await session.pauseSynchronization()
      }
      throw error
    }
  }
}

enum CloudTrackingError: Error { case accountUnavailable, missingConfiguration }
