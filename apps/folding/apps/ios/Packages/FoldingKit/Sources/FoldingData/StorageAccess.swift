import Foundation
import Synchronization

/// The app supplies a short background assertion before shared storage acquires any lock.
/// Kept independent of UIKit so widget extensions and command-line probes can use the data layer.
public enum StorageAccess {
  public typealias Begin = @Sendable () throws -> StorageAccessLease
  private static let provider = Mutex<Begin?>(nil)
  @TaskLocal static var beginForTesting: Begin?
  private static let threadKey = "app.getfolding.storage-access"

  public static func install(_ begin: @escaping Begin) {
    provider.withLock { $0 = begin }
  }

  static func withProtection<T>(_ operation: (StorageAccessLease?) throws -> T) throws -> T {
    // All protected operations are synchronous. Nested SQL statements reuse the outer
    // assertion, which must outlive COMMIT/ROLLBACK and the partition flock unlock.
    if let lease = Thread.current.threadDictionary[threadKey] as? StorageAccessLease {
      try lease.checkCancellation()
      return try operation(lease)
    }
    guard let begin = beginForTesting ?? provider.withLock({ $0 }) else {
      return try operation(nil)
    }
    let lease = try begin()
    Thread.current.threadDictionary[threadKey] = lease
    defer {
      Thread.current.threadDictionary.removeObject(forKey: threadKey)
      lease.finish()
    }
    try lease.checkCancellation()
    return try operation(lease)
  }
}

public final class StorageAccessLease: Sendable {
  private struct State {
    var cancelled = false
    var finished = false
  }
  private let state = Mutex(State())
  private let onEnd: @Sendable () -> Void

  public init(onEnd: @escaping @Sendable () -> Void) { self.onEnd = onEnd }
  public func cancel() { state.withLock { $0.cancelled = true } }
  var isCancelled: Bool { state.withLock { $0.cancelled } }
  func checkCancellation() throws {
    if isCancelled { throw CancellationError() }
  }
  func finish() {
    let end = state.withLock { value in
      guard !value.finished else { return false }
      value.finished = true
      return true
    }
    if end { onEnd() }
  }
}
