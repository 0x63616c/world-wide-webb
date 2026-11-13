import FoldingData
import Synchronization
import UIKit

@MainActor enum StorageBackgroundExecution {
  static func install() {
    let application = UIApplication.shared
    install(
      begin: { handler in
        // Acquire on main before entering any storage lock. UIKit returned invalid
        // identifiers from actor executors in the normal-launch regression.
        let start = {
          let identifier = application.beginBackgroundTask(
            withName: "Shared tracking storage", expirationHandler: handler)
          return identifier
        }
        return Thread.isMainThread ? start() : DispatchQueue.main.sync(execute: start)
      }, end: { application.endBackgroundTask($0) })
  }

  static func install(
    begin:
      @escaping @Sendable (@escaping @MainActor @Sendable () -> Void) -> UIBackgroundTaskIdentifier,
    end: @escaping @Sendable (UIBackgroundTaskIdentifier) -> Void
  ) {
    StorageAccess.install {
      let task = Mutex<UIBackgroundTaskIdentifier>(.invalid)
      let lease = StorageAccessLease {
        let identifier = task.withLock { value in
          let identifier = value
          value = .invalid
          return identifier
        }
        if identifier != .invalid { end(identifier) }
      }
      // Acquire before flock/SQLite; expiry cancels SQL, then rollback/unlock ends it.
      let identifier = begin {
        lease.cancel()
      }
      guard identifier != .invalid else { throw CancellationError() }
      task.withLock { $0 = identifier }
      return lease
    }
  }
}
