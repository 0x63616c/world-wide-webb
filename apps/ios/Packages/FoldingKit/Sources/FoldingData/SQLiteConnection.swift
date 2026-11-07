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
    let result = sqlite3_open_v2(
      url.path, &handle,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
    guard result == SQLITE_OK else {
      if let handle { sqlite3_close(handle) }
      self.handle = nil
      throw StoreError.database(result)
    }
    sqlite3_busy_timeout(handle, 1000)
    try retryBusy { try execute("PRAGMA journal_mode=WAL") }
    try execute("PRAGMA foreign_keys=ON")
    try execute("PRAGMA synchronous=FULL")
  }

  deinit { sqlite3_close(handle) }

  enum Value {
    case text(String)
    case integer(Int64)
    case null
  }

  func execute(_ sql: String, _ bindings: [Value] = []) throws {
    _ = try rows(sql, bindings)
  }

  func rows(_ sql: String, _ bindings: [Value] = []) throws -> [[String: String]] {
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
      let result = sqlite3_step(statement)
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
    try retryBusy { try execute(write ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED") }
    do {
      let result = try operation()
      try execute("COMMIT")
      return result
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }
}
