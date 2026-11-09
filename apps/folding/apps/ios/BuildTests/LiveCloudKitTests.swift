#if LIVE_CLOUDKIT_INTEGRATION
  import CloudKit
  import CoreData
  import FoldingData
  import FoldingDomain
  import Foundation
  import XCTest

  @MainActor final class LiveCloudKitTests: XCTestCase {
    func testPrivateEventAndResetConvergeAcrossIndependentStores() async throws {
      let containerID = try XCTUnwrap(
        Bundle.main.object(forInfoDictionaryKey: "FoldingCloudContainerIdentifier") as? String)
      let container = CKContainer(identifier: containerID)
      guard try await container.accountStatus() == .available else {
        throw XCTSkip("The simulator has no available iCloud account")
      }

      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
        "folding-live-cloudkit-\(UUID())", isDirectory: true)
      let sourceJournal = try TrackingStore(
        directory: directory.appendingPathComponent("source-journal"), installationID: UUID())
      let source = try await PrivateCloudMirror(
        directory: directory.appendingPathComponent("source-mirror"),
        containerIdentifier: containerID)
      let sourceSync = PrivateSyncCoordinator(journal: sourceJournal, mirror: source)

      let now = Int64(Date().timeIntervalSince1970 * 1000)
      // Repeated probes share the same CloudKit container. Import any earlier reset
      // before creating this run's generation; an event in .initial is otherwise stale.
      let sourceImportDeadline = Date().addingTimeInterval(60)
      while Date() < sourceImportDeadline {
        _ = try await sourceSync.synchronize(nowMS: now)
        if try await sourceJournal.currentGeneration().revision > 0 { break }
        try await Task.sleep(for: .seconds(3))
      }
      let probeGeneration = try await sourceJournal.reset(nowMS: now + 1)
      let exported = expectation(
        forNotification: NSPersistentCloudKitContainer.eventChangedNotification,
        object: nil
      ) { notification in
        guard
          let cloudEvent = notification.userInfo?[
            NSPersistentCloudKitContainer.eventNotificationUserInfoKey
          ] as? NSPersistentCloudKitContainer.Event
        else { return false }
        return cloudEvent.storeIdentifier == source.storeID
          && cloudEvent.type == .export && cloudEvent.endDate != nil && cloudEvent.succeeded
      }
      _ = try await sourceJournal.record(
        Observation(
          generation: probeGeneration, transition: .open, observedAtMS: now + 2,
          timezoneID: "UTC"), nowMS: now + 2)
      _ = try await sourceSync.synchronize(nowMS: now + 3)
      await fulfillment(of: [exported], timeout: 60)

      // A fresh store schedules its initial import after the source export has finished.
      // Two already-open stores on one simulator do not prove remote-change push delivery.
      let destinationJournal = try TrackingStore(
        directory: directory.appendingPathComponent("destination-journal"), installationID: UUID())
      let destination = try await PrivateCloudMirror(
        directory: directory.appendingPathComponent("destination-mirror"),
        containerIdentifier: containerID)
      let destinationSync = PrivateSyncCoordinator(journal: destinationJournal, mirror: destination)

      let deadline = Date().addingTimeInterval(90)
      var imported = false
      while Date() < deadline {
        _ = try await destinationSync.synchronize(nowMS: now + 4)
        if try await destinationJournal.summary().folds == 1 {
          imported = true
          break
        }
        try await Task.sleep(for: .seconds(3))
      }
      XCTAssertTrue(imported, "CloudKit did not import the fold into the second journal")
      guard imported else { return }

      let resetExported = expectation(
        forNotification: NSPersistentCloudKitContainer.eventChangedNotification,
        object: nil
      ) { notification in
        guard
          let cloudEvent = notification.userInfo?[
            NSPersistentCloudKitContainer.eventNotificationUserInfoKey
          ] as? NSPersistentCloudKitContainer.Event
        else { return false }
        return cloudEvent.storeIdentifier == destination.storeID
          && cloudEvent.type == .export && cloudEvent.endDate != nil && cloudEvent.succeeded
      }
      let generation = try await destinationJournal.reset(nowMS: now + 5)
      _ = try await destinationSync.synchronize(nowMS: now + 6)
      await fulfillment(of: [resetExported], timeout: 60)

      let thirdJournal = try TrackingStore(
        directory: directory.appendingPathComponent("third-journal"), installationID: UUID())
      let third = try await PrivateCloudMirror(
        directory: directory.appendingPathComponent("third-mirror"),
        containerIdentifier: containerID)
      let thirdSync = PrivateSyncCoordinator(journal: thirdJournal, mirror: third)
      var resetImported = false
      let resetDeadline = Date().addingTimeInterval(90)
      while Date() < resetDeadline {
        _ = try await thirdSync.synchronize(nowMS: now + 7)
        if try await thirdJournal.currentGeneration() == generation,
          try await thirdJournal.summary().folds == 0
        {
          resetImported = true
          break
        }
        try await Task.sleep(for: .seconds(3))
      }
      XCTAssertTrue(resetImported, "CloudKit did not import the reset into the third journal")
      try await third.close()
      try await destination.close()
      try await source.close()
      try FileManager.default.removeItem(at: directory)
    }
  }
#endif
