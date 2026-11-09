#if DEBUG
  import CoreData
  import Foundation

  /// Receipt describes the exact compiled model, not a handwritten CloudKit approximation.
  public struct PrivateCloudSchemaDescription: Codable, Sendable {
    public struct Attribute: Codable, Sendable {
      public let name: String
      public let type: UInt
      public let optional: Bool
    }
    public struct Entity: Codable, Sendable {
      public let name: String
      public let versionHash: String
      public let attributes: [Attribute]
      public let localIndexes: [String: [String]]
    }
    public let formatVersion: Int
    public let entities: [Entity]

    init(model: NSManagedObjectModel) {
      formatVersion = 1
      entities = model.entities.sorted { ($0.name ?? "") < ($1.name ?? "") }.map { entity in
        Entity(
          name: entity.name ?? "",
          versionHash: entity.versionHash.map { String(format: "%02x", $0) }.joined(),
          attributes: entity.attributesByName.values.sorted { $0.name < $1.name }.map {
            Attribute(name: $0.name, type: $0.attributeType.rawValue, optional: $0.isOptional)
          },
          localIndexes: Dictionary(
            uniqueKeysWithValues: entity.indexes.map { index in
              (index.name, index.elements.compactMap { $0.property?.name })
            }))
      }
    }
  }
#endif
