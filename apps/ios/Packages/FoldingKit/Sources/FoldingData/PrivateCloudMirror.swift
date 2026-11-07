import CloudKit
import CoreData
import FoldingDomain
import Foundation

public struct MirrorHistoryBatch: Sendable {
  public let records: [MirrorRecord]
  public let checkpoint: Data?
  public let transactionCount: Int
}

public enum MirrorError: Error {
  case invalidRecord
  case closed
  case invalidCheckpoint
}

/// App-process-only replication store. All managed objects stay within their context's queue.
public actor PrivateCloudMirror {
  private let container: NSPersistentCloudKitContainer
  private var closed = false
  private var cleaning = false
  public nonisolated let storeID: String

  /// A nil container identifier creates an on-disk local mirror for integration tests, without cloud access.
  public init(directory: URL, containerIdentifier: String?) async throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let model = Self.model()
    let container = NSPersistentCloudKitContainer(
      name: "FoldingPrivateMirror", managedObjectModel: model)
    let description = NSPersistentStoreDescription(
      url: directory.appendingPathComponent("mirror.sqlite"))
    description.shouldMigrateStoreAutomatically = true
    description.shouldInferMappingModelAutomatically = true
    description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
    description.setOption(
      true as NSNumber, forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
    #if os(iOS)
      description.setOption(
        FileProtectionType.completeUntilFirstUserAuthentication as NSObject,
        forKey: NSPersistentStoreFileProtectionKey)
    #endif
    if let containerIdentifier {
      let options = NSPersistentCloudKitContainerOptions(containerIdentifier: containerIdentifier)
      options.databaseScope = .private
      description.cloudKitContainerOptions = options
    }
    container.persistentStoreDescriptions = [description]
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      container.loadPersistentStores { _, error in
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
      }
    }
    guard let store = container.persistentStoreCoordinator.persistentStores.first,
      let id = container.persistentStoreCoordinator.metadata(for: store)[NSStoreUUIDKey] as? String
    else { throw MirrorError.invalidRecord }
    self.container = container
    self.storeID = id
  }

  /// Local save only. CloudKit export follows Apple's scheduling and is observed separately.
  public func save(_ record: MirrorRecord) async throws {
    guard !closed else { throw MirrorError.closed }
    let context = container.newBackgroundContext()
    context.transactionAuthor = "folding-mirror"
    try await context.perform {
      let request = NSFetchRequest<NSManagedObject>(entityName: record.entityName)
      request.predicate = NSPredicate(
        format: "logicalID == %@", record.logicalID.uuidString.lowercased())
      let existing = try context.fetch(request)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      let payload = try encoder.encode(record)
      // There is intentionally no uniqueness constraint: duplicates can arrive through CloudKit.
      for object in existing {
        if let data = object.value(forKey: "payload") as? Data,
          try JSONDecoder().decode(MirrorRecord.self, from: data) == record
        {
          return
        }
      }
      let object = NSEntityDescription.insertNewObject(
        forEntityName: record.entityName, into: context)
      object.setValue(record.logicalID.uuidString.lowercased(), forKey: "logicalID")
      object.setValue(payload, forKey: "payload")
      Self.indexGeneration(of: record, on: object)
      try context.save()
    }
  }

  public func history(after checkpoint: Data?, limit: Int = 100) async throws -> MirrorHistoryBatch
  {
    guard !closed else { throw MirrorError.closed }
    guard (1...1000).contains(limit) else { throw StoreError.invalidInput }
    let context = container.newBackgroundContext()
    return try await context.perform {
      let token: NSPersistentHistoryToken?
      if let checkpoint {
        guard
          let decoded = try NSKeyedUnarchiver.unarchivedObject(
            ofClass: NSPersistentHistoryToken.self, from: checkpoint)
        else { throw MirrorError.invalidCheckpoint }
        token = decoded
      } else {
        token = nil
      }
      let request = NSPersistentHistoryChangeRequest.fetchHistory(after: token)
      request.resultType = .transactionsAndChanges
      let fetch = NSPersistentHistoryTransaction.fetchRequest!
      fetch.fetchLimit = limit
      request.fetchRequest = fetch
      guard let result = try context.execute(request) as? NSPersistentHistoryResult,
        let transactions = result.result as? [NSPersistentHistoryTransaction]
      else { throw MirrorError.invalidRecord }
      let ordered = Array(
        transactions.sorted { $0.transactionNumber < $1.transactionNumber }.prefix(limit))
      var records: [MirrorRecord] = []
      var visited = Set<NSManagedObjectID>()
      for transaction in ordered {
        // Cleanup changes only derived indexes/deletions; their transaction token still advances.
        if transaction.author == "folding-cleanup" { continue }
        for change in transaction.changes ?? [] where change.changeType != .delete {
          if change.changeType == .update, let properties = change.updatedProperties,
            !properties.isEmpty,
            properties.allSatisfy({ $0.name == "generationRevision" || $0.name == "generationID" })
          {
            continue
          }
          guard visited.insert(change.changedObjectID).inserted else { continue }
          // A later cleanup may have deleted an old-generation record. Reset tombstones remain durable.
          let object: NSManagedObject
          do { object = try context.existingObject(with: change.changedObjectID) } catch {
            let failure = error as NSError
            if failure.domain == NSCocoaErrorDomain
              && failure.code == NSManagedObjectReferentialIntegrityError
            {
              continue
            }
            throw error
          }
          guard !object.isDeleted else { continue }
          guard let payload = object.value(forKey: "payload") as? Data,
            let id = object.value(forKey: "logicalID") as? String
          else { throw MirrorError.invalidRecord }
          let record = try JSONDecoder().decode(MirrorRecord.self, from: payload)
          guard id == record.logicalID.uuidString.lowercased(),
            object.entity.name == record.entityName
          else { throw MirrorError.invalidRecord }
          records.append(record)
        }
      }
      let next = try ordered.last.map {
        try NSKeyedArchiver.archivedData(withRootObject: $0.token, requiringSecureCoding: true)
      }
      return MirrorHistoryBatch(
        records: records, checkpoint: next, transactionCount: ordered.count)
    }
  }

  /// Capture the history boundary before pinning the read snapshot. Later writes are replayed
  /// through history even if they also appear in the snapshot; duplication is safe, skipping is not.
  func recoverySnapshot() async throws -> MirrorRecoverySnapshot {
    guard !closed else { throw MirrorError.closed }
    let token = container.persistentStoreCoordinator.currentPersistentHistoryToken(fromStores: nil)
    let checkpoint = try token.map {
      try NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true)
    }
    let context = container.newBackgroundContext()
    try await context.perform { try context.setQueryGenerationFrom(.current) }
    return MirrorRecoverySnapshot(context: context, checkpoint: checkpoint)
  }

  /// Each committed backfill/delete is its own durable progress. No offset can skip rows after
  /// deletion, and a restart discovers the remaining null indexes/obsolete rows directly.
  public func cleanup(before generation: ResetGeneration, limit: Int = 500) async throws
    -> MirrorCleanupReport
  {
    guard !closed else { throw MirrorError.closed }
    guard (1...1000).contains(limit), !cleaning else { throw StoreError.invalidInput }
    cleaning = true
    defer { cleaning = false }
    _ = try TrackingReducer.reduce(events: [], generation: generation)
    guard generation.revision > 0 else {
      return MirrorCleanupReport(indexedRecords: 0, deletedRecords: 0)
    }
    let context = container.newBackgroundContext()
    context.transactionAuthor = "folding-cleanup"
    return try await context.perform {
      // A journal commit alone cannot authorize deleting the mirror's last copy of history.
      // The corresponding immutable reset tombstone must already have reached this mirror.
      let resetRequest = NSFetchRequest<NSManagedObject>(entityName: "ResetMarker")
      resetRequest.predicate = NSPredicate(
        format: "logicalID == %@", generation.resetID.uuidString.lowercased())
      resetRequest.fetchLimit = 1
      guard let reset = try context.fetch(resetRequest).first,
        let resetData = reset.value(forKey: "payload") as? Data,
        case .reset(let saved, _) = try JSONDecoder().decode(MirrorRecord.self, from: resetData),
        saved == generation
      else { return MirrorCleanupReport(indexedRecords: 0, deletedRecords: 0) }
      var indexed = 0
      var deleted = 0
      for entity in ["ReplicatedEvent", "TrackingInterruption"] {
        let budget = limit - indexed - deleted
        if budget == 0 { break }
        let legacy = NSFetchRequest<NSManagedObject>(entityName: entity)
        legacy.predicate = NSPredicate(format: "generationRevision == nil OR generationID == nil")
        legacy.fetchLimit = budget
        for object in try context.fetch(legacy) {
          guard let payload = object.value(forKey: "payload") as? Data,
            let id = object.value(forKey: "logicalID") as? String
          else { throw MirrorError.invalidRecord }
          let record = try JSONDecoder().decode(MirrorRecord.self, from: payload)
          guard record.entityName == entity, record.logicalID.uuidString.lowercased() == id,
            record.generation != nil
          else { throw MirrorError.invalidRecord }
          Self.indexGeneration(of: record, on: object)
          indexed += 1
        }
        let remaining = limit - indexed - deleted
        if remaining == 0 { continue }
        let obsolete = NSFetchRequest<NSManagedObject>(entityName: entity)
        obsolete.predicate = NSPredicate(
          format: "generationRevision < %@ OR (generationRevision == %@ AND generationID < %@)",
          NSNumber(value: generation.revision), NSNumber(value: generation.revision),
          generation.resetID.uuidString.lowercased())
        obsolete.fetchLimit = remaining
        for object in try context.fetch(obsolete) {
          // Confirm payload semantics too; a damaged derived index must never delete newer data.
          guard let payload = object.value(forKey: "payload") as? Data else {
            throw MirrorError.invalidRecord
          }
          let record = try JSONDecoder().decode(MirrorRecord.self, from: payload)
          guard record.entityName == entity, let recordedGeneration = record.generation,
            recordedGeneration < generation,
            object.value(forKey: "logicalID") as? String
              == record.logicalID.uuidString.lowercased(),
            (object.value(forKey: "generationRevision") as? NSNumber)?.int64Value
              == recordedGeneration.revision,
            object.value(forKey: "generationID") as? String
              == recordedGeneration.resetID.uuidString.lowercased()
          else { throw MirrorError.invalidRecord }
          context.delete(object)
          deleted += 1
        }
      }
      if context.hasChanges { try context.save() }
      return MirrorCleanupReport(indexedRecords: indexed, deletedRecords: deleted)
    }
  }

  private nonisolated static func indexGeneration(
    of record: MirrorRecord, on object: NSManagedObject
  ) {
    switch record {
    case .event, .interruption:
      guard let generation = record.generation else { return }
      object.setValue(generation.revision, forKey: "generationRevision")
      object.setValue(generation.resetID.uuidString.lowercased(), forKey: "generationID")
    case .reset, .transfer, .transferRejection: break
    }
  }

  // Integration-test seam: exercise real history deletion without exposing it to app callers.
  func pruneHistory(before date: Date) async throws {
    guard !closed else { throw MirrorError.closed }
    let context = container.newBackgroundContext()
    try await context.perform {
      _ = try context.execute(NSPersistentHistoryChangeRequest.deleteHistory(before: date))
    }
  }

  /// Call only after the coordinator has stopped its synchronization pass.
  public func close() throws {
    guard !closed else { return }
    closed = true
    for store in container.persistentStoreCoordinator.persistentStores {
      try container.persistentStoreCoordinator.remove(store)
    }
  }

  #if DEBUG
    /// Explicit development tooling only; never called by normal mirror startup.
    /// Core Data creates/removes its own representative records, including internal types.
    public func initializeDevelopmentSchema() throws -> PrivateCloudSchemaDescription {
      guard !closed else { throw MirrorError.closed }
      guard let options = container.persistentStoreDescriptions.first?.cloudKitContainerOptions,
        options.databaseScope == .private,
        ["iCloud.app.getfolding.Folding", "iCloud.app.getfolding.Folding.Staging"].contains(
          options.containerIdentifier)
      else { throw MirrorError.invalidRecord }
      try container.initializeCloudKitSchema(options: [])
      return PrivateCloudSchemaDescription(model: container.managedObjectModel)
    }
  #endif

  private static func model() -> NSManagedObjectModel {
    let model = NSManagedObjectModel()
    model.entities = ["ReplicatedEvent", "ResetMarker", "TrackingInterruption", "TransferMarker"]
      .map { name in
        let entity = NSEntityDescription()
        entity.name = name
        entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
        let id = NSAttributeDescription()
        id.name = "logicalID"
        id.attributeType = .stringAttributeType
        id.isOptional = true
        id.preservesValueInHistoryOnDeletion = true
        let payload = NSAttributeDescription()
        payload.name = "payload"
        payload.attributeType = .binaryDataAttributeType
        payload.isOptional = true
        var properties: [NSPropertyDescription] = [id, payload]
        // Local Core Data lookup index; remote mirroring uses Apple's generated schema/indexes.
        var indexes = [
          NSFetchIndexDescription(
            name: "logicalIDIndex",
            elements: [NSFetchIndexElementDescription(property: id, collationType: .binary)])
        ]
        if name == "ReplicatedEvent" || name == "TrackingInterruption" {
          let revision = NSAttributeDescription()
          revision.name = "generationRevision"
          revision.attributeType = .integer64AttributeType
          revision.isOptional = true
          let generationID = NSAttributeDescription()
          generationID.name = "generationID"
          generationID.attributeType = .stringAttributeType
          generationID.isOptional = true
          properties += [revision, generationID]
          indexes += [
            NSFetchIndexDescription(
              name: "generationIndex",
              elements: [
                NSFetchIndexElementDescription(property: revision, collationType: .binary),
                NSFetchIndexElementDescription(property: generationID, collationType: .binary),
              ])
          ]
        }
        entity.properties = properties
        entity.indexes = indexes
        return entity
      }
    return model
  }
}
