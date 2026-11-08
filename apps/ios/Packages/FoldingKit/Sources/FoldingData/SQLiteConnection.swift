import FoldingSQLite
import Foundation
import SQLite3

public enum StoreError: Error, Equatable, Sendable {
  case database(Int32)
  case installationChanged
  case incompatibleSchema
  case staleGeneration
  case identityConflict
  case invalidInput
  case exhaustedSequence
}

// Owned by one TrackingStore actor. SQLite additionally serializes writers across processes.
final class SQLiteConnection {
  private var handle: OpaquePointer?

  init(url: URL) throws {
    try StorageAccess.withProtection { _ in
      let result = sqlite3_open_v2(
        url.path, &handle,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
      guard result == SQLITE_OK else {
        if let handle { sqlite3_close(handle) }
        self.handle = nil
        throw StoreError.database(result)
      }
      // Close never initiates a checkpoint or WAL deletion if iOS denies execution time.
      let configured = folding_sqlite_disable_close_checkpoint(handle)
      guard configured == SQLITE_OK else { throw StoreError.database(configured) }
      var persistWAL: Int32 = 1
      let persisted = sqlite3_file_control(handle, nil, SQLITE_FCNTL_PERSIST_WAL, &persistWAL)
      guard persisted == SQLITE_OK else { throw StoreError.database(persisted) }
      sqlite3_busy_timeout(handle, 1000)
      try retryBusy { try execute("PRAGMA journal_mode=WAL") }
      try execute("PRAGMA foreign_keys=ON")
      try execute("PRAGMA synchronous=FULL")
    }
  }

  deinit {
    // sqlite3_close may checkpoint. Keep its lock under an assertion as well.
    if (try? StorageAccess.withProtection({ _ in sqlite3_close(handle) })) == nil {
      // No checkpoint or WAL deletion is allowed on an unasserted idle close.
      sqlite3_close_v2(handle)
    }
  }

  enum Value {
    case text(String)
    case integer(Int64)
    case null
  }

  func execute(_ sql: String, _ bindings: [Value] = []) throws {
    _ = try rows(sql, bindings)
  }

  func rows(_ sql: String, _ bindings: [Value] = []) throws -> [[String: String]] {
    try StorageAccess.withProtection { lease in
      try unprotectedRows(sql, bindings, lease: lease)
    }
  }

  private func unprotectedRows(
    _ sql: String, _ bindings: [Value] = [], lease: StorageAccessLease? = nil
  ) throws -> [[String: String]] {
    if let lease {
      sqlite3_progress_handler(
        handle, 1000,
        { context in
          guard let context else { return 0 }
          return Unmanaged<StorageAccessLease>.fromOpaque(context).takeUnretainedValue().isCancelled
            ? 1 : 0
        }, Unmanaged.passUnretained(lease).toOpaque())
    }
    defer { sqlite3_progress_handler(handle, 0, nil, nil) }
    var statement: OpaquePointer?
    let prepared = sqlite3_prepare_v2(handle, sql, -1, &statement, nil)
    guard prepared == SQLITE_OK else { throw StoreError.database(prepared) }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_bind_parameter_count(statement) == bindings.count else {
      throw StoreError.invalidInput
    }
    for (offset, value) in bindings.enumerated() {
      let index = Int32(offset + 1)
      let result: Int32
      switch value {
      case .text(let value):
        result = value.withCString {
          sqlite3_bind_text(
            statement, index, $0, Int32(value.utf8.count),
            unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
      case .integer(let value): result = sqlite3_bind_int64(statement, index, value)
      case .null: result = sqlite3_bind_null(statement, index)
      }
      guard result == SQLITE_OK else { throw StoreError.database(result) }
    }
    var output: [[String: String]] = []
    while true {
      try lease?.checkCancellation()
      let result = sqlite3_step(statement)
      if result == SQLITE_INTERRUPT { try lease?.checkCancellation() }
      if result == SQLITE_DONE { return output }
      guard result == SQLITE_ROW else { throw StoreError.database(result) }
      var row: [String: String] = [:]
      for column in 0..<sqlite3_column_count(statement) {
        guard sqlite3_column_type(statement, column) != SQLITE_NULL,
          let key = sqlite3_column_name(statement, column),
          let value = sqlite3_column_text(statement, column)
        else { continue }
        row[String(cString: key)] = String(
          decoding: UnsafeBufferPointer(
            start: value, count: Int(sqlite3_column_bytes(statement, column))), as: UTF8.self)
      }
      output.append(row)
    }
  }

  private func retryBusy<T>(_ operation: () throws -> T) throws -> T {
    for attempt in 0...2 {
      do { return try operation() } catch StoreError.database(let code)
        where code == SQLITE_BUSY && attempt < 2
      {
        Thread.sleep(forTimeInterval: Double.random(in: 0.02...0.06))
      }
    }
    throw StoreError.database(SQLITE_BUSY)
  }

  func transaction<T>(write: Bool = true, _ operation: () throws -> T) throws -> T {
    try StorageAccess.withProtection { lease in
      try retryBusy { try execute(write ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED") }
      do {
        let result = try operation()
        try lease?.checkCancellation()
        try execute("COMMIT")
        return result
      } catch {
        // Expiry must still roll back while the assertion protects the held lock.
        _ = try? unprotectedRows("ROLLBACK")
        throw error
      }
    }
  }
}
