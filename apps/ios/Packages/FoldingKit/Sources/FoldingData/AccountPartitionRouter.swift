import CryptoKit
import Darwin
import Foundation

public enum PartitionError: Error, Equatable {
  case inactive
  case superseded
  case busy
  case filesystem(Int32)
}

/// Supply an identity only after checking the current CloudKit account. Never use an Apple ID email.
public enum PrivateAccountIdentity: Sendable {
  case iCloud(containerIdentifier: String, userRecordName: String)
  /// A new identifier on sign-out gives a fresh local-only namespace; retain it across local launches.
  case local(UUID)

  fileprivate var key: String {
    switch self {
    case .iCloud(let container, let user):
      let encoded = try! JSONEncoder().encode([container, user])
      return "cloud-" + SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
    case .local(let id): return "local-" + id.uuidString.lowercased()
    }
  }
}

public struct PartitionLease: Sendable, Equatable {
  fileprivate let root: URL
  fileprivate let epoch: UUID
  fileprivate let key: String
  let installationID: UUID
  public var directory: URL {
    root.appendingPathComponent("partitions").appendingPathComponent(key)
  }

  func withActive<T>(_ operation: () throws -> T) throws -> T {
    try AccountPartitionRouter(directory: root).locked(exclusive: false) {
      let state = try AccountPartitionRouter(directory: root).read()
      guard state?.active == true, state?.epoch == epoch, state?.key == key,
        state?.installationID == installationID
      else {
        throw PartitionError.inactive
      }
      return try operation()
    }
  }
}

public struct PartitionTransition: Sendable {
  fileprivate let root: URL
  fileprivate let epoch: UUID
}

/// A durable cross-process fence shared by the app, intents and widget readers.
/// The app owns transitions; consumers may only open a journal using the active lease.
public struct AccountPartitionRouter: Sendable {
  private let directory: URL
  public init(directory: URL) {
    self.directory = URL(fileURLWithPath: directory.standardizedFileURL.path, isDirectory: true)
  }

  fileprivate struct State: Codable {
    let epoch: UUID
    let key: String?
    let active: Bool
    let installationID: UUID?
  }

  public func currentLease(installationID: UUID) throws -> PartitionLease? {
    try locked(exclusive: false) {
      guard let state = try read(), state.active, state.installationID == installationID,
        let key = state.key
      else { return nil }
      return PartitionLease(
        root: directory, epoch: state.epoch, key: key, installationID: installationID)
    }
  }

  /// Normal app activation reuses a matching verified account without interrupting an open session.
  public func currentLease(forVerified account: PrivateAccountIdentity, installationID: UUID) throws
    -> PartitionLease?
  {
    guard let lease = try currentLease(installationID: installationID), lease.key == account.key
    else { return nil }
    return lease
  }

  /// Fences old readers/writers durably before any async mirror shutdown or account lookup.
  /// If the process dies after this commit, intents stay paused until app reconciliation.
  public func suspend() throws -> PartitionTransition {
    try locked(exclusive: true) {
      let epoch = UUID()
      try write(State(epoch: epoch, key: nil, active: false, installationID: nil))
      return PartitionTransition(root: directory, epoch: epoch)
    }
  }

  /// Call only after old sync workers have stopped and the target account has been verified.
  public func activate(
    _ account: PrivateAccountIdentity, transition: PartitionTransition, installationID: UUID
  ) throws -> PartitionLease {
    guard transition.root == directory else { throw PartitionError.superseded }
    return try locked(exclusive: true) {
      guard let state = try read(), !state.active, state.epoch == transition.epoch else {
        throw PartitionError.superseded
      }
      let lease = PartitionLease(
        root: directory, epoch: transition.epoch, key: account.key, installationID: installationID)
      // Invalidate any spanning session and public enrollment before exposing this partition.
      let journalDirectory = lease.directory.appendingPathComponent("journal")
      try TrackingStore.preparePartitionActivation(
        directory: journalDirectory, installationID: installationID)
      try write(
        State(epoch: lease.epoch, key: lease.key, active: true, installationID: installationID))
      return lease
    }
  }

  public func openJournal(lease: PartitionLease, installationID: UUID) throws -> TrackingStore {
    guard lease.root == directory, lease.installationID == installationID else {
      throw PartitionError.inactive
    }
    return try TrackingStore(
      directory: lease.directory.appendingPathComponent("journal"), installationID: installationID,
      partitionLease: lease)
  }

  fileprivate func read() throws -> State? {
    let file = directory.appendingPathComponent("route.json")
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    return try JSONDecoder().decode(State.self, from: Data(contentsOf: file))
  }

  private func write(_ state: State) throws {
    let file = directory.appendingPathComponent("route.json")
    try JSONEncoder().encode(state).write(to: file, options: .atomic)
    // Atomic replacement prevents torn JSON; fsync also makes the fence durable before returning.
    for path in [file.path, directory.path] {
      let descriptor = open(path, O_RDONLY)
      guard descriptor >= 0 else { throw PartitionError.filesystem(errno) }
      let result = fsync(descriptor)
      let failure = errno
      close(descriptor)
      guard result == 0 else { throw PartitionError.filesystem(failure) }
    }
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: file.path)
    #endif
  }

  fileprivate func locked<T>(exclusive: Bool, _ operation: () throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: directory.path)
    #endif
    let descriptor = open(
      directory.appendingPathComponent("route.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw PartitionError.filesystem(errno) }
    defer { close(descriptor) }
    let deadline = ProcessInfo.processInfo.systemUptime + 1
    while flock(descriptor, (exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK else { throw PartitionError.filesystem(errno) }
      guard ProcessInfo.processInfo.systemUptime < deadline else { throw PartitionError.busy }
      Thread.sleep(forTimeInterval: 0.01)
    }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
  }
}
