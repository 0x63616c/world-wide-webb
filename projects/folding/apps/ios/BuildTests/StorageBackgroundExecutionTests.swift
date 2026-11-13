import Foundation
import Synchronization
import UIKit
import XCTest

@testable import Folding
@testable import FoldingData

@MainActor final class StorageBackgroundExecutionTests: XCTestCase {
  override func tearDown() async throws {
    StorageBackgroundExecution.install()
    try await super.tearDown()
  }

  func testActualUIKitProviderProtectsActorStorage() async throws {
    StorageBackgroundExecution.install()
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let generation = try await journal.currentGeneration()
    XCTAssertEqual(generation.revision, 0)
  }

  func testRepeatedStorageProtectionKeepsProviderStackBounded() throws {
    let positions = Mutex<[UInt]>([])
    StorageAccess.install {
      if Thread.isMainThread {
        var marker: UInt8 = 0
        let position = withUnsafePointer(to: &marker) { UInt(bitPattern: $0) }
        positions.withLock { $0.append(position) }
      }
      return StorageAccessLease {}
    }
    for _ in 0..<2048 {
      try StorageAccess.withProtection { _ in () }
    }
    let values = positions.withLock { $0 }
    XCTAssertEqual(values.count, 2048)
    if let minimum = values.min(), let maximum = values.max() {
      XCTAssertLessThan(maximum - minimum, 4096, "Storage reads accumulate closure call frames")
    }
  }

  func testAssertionRemainsActiveUntilProtectedStorageReturns() throws {
    let active = Mutex(false)
    let ended = Mutex(0)
    StorageBackgroundExecution.install(
      begin: { _ in
        active.withLock { $0 = true }
        return UIBackgroundTaskIdentifier(rawValue: 42)
      },
      end: { identifier in
        XCTAssertEqual(identifier.rawValue, 42)
        active.withLock { $0 = false }
        ended.withLock { $0 += 1 }
      })
    try StorageAccess.withProtection { _ in
      XCTAssertTrue(active.withLock { $0 })
      try StorageAccess.withProtection { _ in XCTAssertTrue(active.withLock { $0 }) }
      XCTAssertEqual(ended.withLock { $0 }, 0)
    }
    XCTAssertFalse(active.withLock { $0 })
    XCTAssertEqual(ended.withLock { $0 }, 1)
  }

  func testDeniedAssertionRefusesStorageWork() {
    StorageBackgroundExecution.install(
      begin: { _ in .invalid }, end: { _ in XCTFail("Invalid assertion ended") })
    XCTAssertThrowsError(
      try StorageAccess.withProtection { _ in XCTFail("Unprotected storage ran") }
    ) {
      XCTAssertTrue($0 is CancellationError)
    }
  }

  func testUIKitExpirationCancelsStorageBeforeEndingAssertion() throws {
    let expiration = Mutex<(@MainActor @Sendable () -> Void)?>(nil)
    let ended = Mutex(false)
    StorageBackgroundExecution.install(
      begin: { handler in
        expiration.withLock { $0 = handler }
        return UIBackgroundTaskIdentifier(rawValue: 7)
      }, end: { _ in ended.withLock { $0 = true } })
    XCTAssertThrowsError(
      try StorageAccess.withProtection { lease in
        expiration.withLock { $0 }?()
        XCTAssertFalse(ended.withLock { $0 })
        try lease?.checkCancellation()
      }
    ) { XCTAssertTrue($0 is CancellationError) }
    XCTAssertTrue(ended.withLock { $0 })
  }
}
