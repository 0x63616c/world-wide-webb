import CoreData
import Foundation

/// A pinned, bounded-payload rescan. A crash discards this cursor and safely starts again.
actor MirrorRecoverySnapshot {
  nonisolated let checkpoint: Data?
  private let context: NSManagedObjectContext
  private var entityIndex = 0
  private var offset = 0
  private var reading = false
  // Reset tombstones are imported first; future generations still defer in the journal.
  private let entities = [
    "ResetMarker", "TrackingInterruption", "ReplicatedEvent", "TransferMarker",
  ]

  init(context: NSManagedObjectContext, checkpoint: Data?) {
    self.context = context
    self.checkpoint = checkpoint
  }

  func next(limit: Int = 500) async throws -> [MirrorRecord]? {
    guard (1...1000).contains(limit), !reading else { throw StoreError.invalidInput }
    reading = true
    defer { reading = false }
    while entityIndex < entities.count {
      let entity = entities[entityIndex]
      let start = offset
      let context = self.context
      let records = try await context.perform {
        let request = NSFetchRequest<NSManagedObject>(entityName: entity)
        request.sortDescriptors = [NSSortDescriptor(key: "self", ascending: true)]
        request.fetchOffset = start
        request.fetchLimit = limit
        return try self.decode(context.fetch(request))
      }
      offset += records.count
      if records.count < limit {
        entityIndex += 1
        offset = 0
      }
      if !records.isEmpty { return records }
    }
    return nil
  }

  private nonisolated func decode(_ objects: [NSManagedObject]) throws -> [MirrorRecord] {
    try objects.map { object in
      guard let data = object.value(forKey: "payload") as? Data,
        let id = object.value(forKey: "logicalID") as? String
      else { throw MirrorError.invalidRecord }
      let record = try JSONDecoder().decode(MirrorRecord.self, from: data)
      guard record.logicalID.uuidString.lowercased() == id,
        record.entityName == object.entity.name
      else { throw MirrorError.invalidRecord }
      return record
    }
  }
}
