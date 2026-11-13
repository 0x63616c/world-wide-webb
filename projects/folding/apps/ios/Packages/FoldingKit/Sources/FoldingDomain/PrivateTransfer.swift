import Foundation

/// Immutable private selection. Public competition epochs remain a separate server contract.
public struct PrivateTransferMarker: Codable, Equatable, Sendable {
  public let transferID: UUID
  public let revision: Int64
  public let activeDeviceID: UUID
  public let sourceWatermarks: [UUID: Int64]
  public let createdAtMS: Int64

  public init(
    transferID: UUID, revision: Int64, activeDeviceID: UUID, sourceWatermarks: [UUID: Int64],
    createdAtMS: Int64
  ) {
    self.transferID = transferID
    self.revision = revision
    self.activeDeviceID = activeDeviceID
    self.sourceWatermarks = sourceWatermarks
    self.createdAtMS = createdAtMS
  }

  enum CodingKeys: String, CodingKey {
    case transferID = "transfer_id"
    case revision
    case activeDeviceID = "active_device_id"
    case sourceWatermarks = "source_watermarks"
    case createdAtMS = "created_at_ms"
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    transferID = try c.decode(UUID.self, forKey: .transferID)
    revision = try c.decode(Int64.self, forKey: .revision)
    activeDeviceID = try c.decode(UUID.self, forKey: .activeDeviceID)
    createdAtMS = try c.decode(Int64.self, forKey: .createdAtMS)
    let raw = try c.decode([String: Int64].self, forKey: .sourceWatermarks)
    var parsed: [UUID: Int64] = [:]
    for (key, value) in raw {
      guard let id = UUID(uuidString: key), parsed[id] == nil else {
        throw DecodingError.dataCorruptedError(
          forKey: .sourceWatermarks, in: c, debugDescription: "Invalid or repeated device identity")
      }
      parsed[id] = value
    }
    sourceWatermarks = parsed
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(transferID.uuidString.lowercased(), forKey: .transferID)
    try c.encode(revision, forKey: .revision)
    try c.encode(activeDeviceID.uuidString.lowercased(), forKey: .activeDeviceID)
    try c.encode(
      Dictionary(
        uniqueKeysWithValues: sourceWatermarks.map { ($0.key.uuidString.lowercased(), $0.value) }),
      forKey: .sourceWatermarks)
    try c.encode(createdAtMS, forKey: .createdAtMS)
  }
}

public enum PrivateTransferPolicy {
  public static func winner(_ markers: [PrivateTransferMarker]) throws -> PrivateTransferMarker? {
    var byID: [UUID: PrivateTransferMarker] = [:]
    for marker in markers {
      guard (1...TrackingReducer.maximumInteger).contains(marker.revision),
        (0...TrackingReducer.maximumInteger).contains(marker.createdAtMS),
        marker.sourceWatermarks.values.allSatisfy({
          (0...TrackingReducer.maximumInteger).contains($0)
        })
      else { throw TrackingError.invalidEnvelope }
      if let previous = byID[marker.transferID], previous != marker {
        throw TrackingError.identityConflict
      }
      byID[marker.transferID] = marker
    }
    return byID.values.max {
      if $0.revision != $1.revision { return $0.revision < $1.revision }
      return $0.transferID.uuidString < $1.transferID.uuidString
    }
  }

  public static func includes(_ event: TrackingEvent, under marker: PrivateTransferMarker?) -> Bool
  {
    guard let marker, event.deviceID != marker.activeDeviceID else { return true }
    return event.sequence <= marker.sourceWatermarks[event.deviceID, default: 0]
  }
}
