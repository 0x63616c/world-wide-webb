import Darwin
import Foundation
import Synchronization
import Testing

@testable import FoldingData

@Test func databaseLocksHaveExecutionProtectionOutsideScreenRefresh() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let active = Mutex(0)
  try StorageAccess.$beginForTesting.withValue(
    {
      active.withLock { $0 += 1 }
      return StorageAccessLease { active.withLock { $0 -= 1 } }
    },
    operation: {
      let database = try SQLiteConnection(url: directory.appendingPathComponent("test.sqlite"))
      try database.execute("CREATE TABLE test (value INTEGER)")
      try database.transaction {
        #expect(active.withLock { $0 } == 1, "SQLite transaction can be suspended holding its lock")
        try database.execute("INSERT INTO test VALUES (1)")
      }
      #expect(active.withLock { $0 } == 0)
      try database.transaction(write: false) {
        #expect(active.withLock { $0 } == 1, "Read locks also require execution protection")
        let rows = try database.rows("SELECT value FROM test")
        #expect(rows.first?["value"] == "1")
      }
      #expect(active.withLock { $0 } == 0)
    })
}

@Test func partitionLocksAreProtectedBeforeReadingTheRoute() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let calls = Mutex(0)
  StorageAccess.$beginForTesting.withValue(
    {
      calls.withLock { $0 += 1 }
      throw CancellationError()
    },
    operation: {
      #expect(throws: CancellationError.self) {
        _ = try AccountPartitionRouter(directory: directory).currentLease(installationID: UUID())
      }
    })
  #expect(calls.withLock { $0 } == 1)
  #expect(
    !FileManager.default.fileExists(atPath: directory.appendingPathComponent("route.lock").path))
}

@Test func expiredStorageAssertionRollsBackBeforeEnding() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let database = try SQLiteConnection(url: directory.appendingPathComponent("test.sqlite"))
  try database.execute("CREATE TABLE test (value INTEGER)")
  let ended = Mutex(0)
  let current = Mutex<StorageAccessLease?>(nil)
  StorageAccess.$beginForTesting.withValue(
    {
      let lease = StorageAccessLease { ended.withLock { $0 += 1 } }
      current.withLock { $0 = lease }
      return lease
    },
    operation: {
      #expect(throws: CancellationError.self) {
        try database.transaction {
          try database.execute("INSERT INTO test VALUES (1)")
          current.withLock { $0 }?.cancel()
        }
      }
      #expect(ended.withLock { $0 } == 1)
    })
  let rows = try database.rows("SELECT count(*) AS n FROM test")
  #expect(rows.first?["n"] == "0")
  // Another writer can acquire the lock, and a retry succeeds without a partial row.
  let other = try SQLiteConnection(url: directory.appendingPathComponent("test.sqlite"))
  try other.transaction { try other.execute("INSERT INTO test VALUES (2)") }
  let retry = try database.rows("SELECT value FROM test")
  #expect(retry.map { $0["value"] } == ["2"])
}

@Test func deniedExecutionTimeDoesNotOpenSQLite() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let file = directory.appendingPathComponent("test.sqlite")
  StorageAccess.$beginForTesting.withValue(
    { throw CancellationError() },
    operation: {
      #expect(throws: CancellationError.self) { _ = try SQLiteConnection(url: file) }
    })
  #expect(!FileManager.default.fileExists(atPath: file.path))
}

@Test func expiredLeaseRefusesFurtherStatementsAndStillUnlocks() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let database = try SQLiteConnection(url: directory.appendingPathComponent("test.sqlite"))
  let current = Mutex<StorageAccessLease?>(nil)
  StorageAccess.$beginForTesting.withValue(
    {
      let lease = StorageAccessLease(onEnd: {})
      current.withLock { $0 = lease }
      return lease
    },
    operation: {
      #expect(throws: CancellationError.self) {
        try database.transaction {
          current.withLock { $0 }?.cancel()
          _ = try database.rows("SELECT 1")
        }
      }
    })
  try database.transaction { try database.execute("SELECT 1") }
}

@Test func assertionEndsAfterPartitionUnlock() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let released = Mutex(false)
  _ = try StorageAccess.$beginForTesting.withValue(
    {
      StorageAccessLease {
        let descriptor = open(directory.appendingPathComponent("route.lock").path, O_RDWR)
        guard descriptor >= 0 else { return }
        defer { close(descriptor) }
        let acquired = flock(descriptor, LOCK_EX | LOCK_NB) == 0
        if acquired { flock(descriptor, LOCK_UN) }
        released.withLock { $0 = acquired }
      }
    },
    operation: {
      try AccountPartitionRouter(directory: directory).suspend()
    })
  #expect(
    released.withLock { $0 }, "Execution protection ended while the route lock was still held")
}

@Test func expiryInterruptsAnExecutingSQLiteStatement() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let database = try SQLiteConnection(url: directory.appendingPathComponent("test.sqlite"))
  let ended = Mutex(false)
  let lease = StorageAccessLease { ended.withLock { $0 = true } }
  StorageAccess.$beginForTesting.withValue(
    { lease },
    operation: {
      DispatchQueue.global().asyncAfter(deadline: .now() + 0.02) { lease.cancel() }
      #expect(throws: CancellationError.self) {
        _ = try database.rows(
          "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<1000000000) SELECT sum(n) FROM numbers"
        )
      }
    })
  #expect(ended.withLock { $0 })
  try database.transaction { try database.execute("CREATE TABLE after_expiry (n INTEGER)") }
}
