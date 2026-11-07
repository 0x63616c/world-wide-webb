import Foundation

public enum Transition: String, Codable, Sendable { case open, close }
public enum InterruptionReason: String, Codable, Sendable {
  case deviceRestart = "device_restart"
  case trackingInterruption = "tracking_interruption"
  case transferAway = "transfer_away"
}

public struct ResetGeneration: Codable, Hashable, Sendable {
  public let revision: Int64
  public let resetID: UUID

  public init(revision: Int64, resetID: UUID) {
    self.revision = revision
    self.resetID = resetID
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(revision, forKey: .revision)
    try container.encode(resetID.uuidString.lowercased(), forKey: .resetID)
  }

  enum CodingKeys: String, CodingKey {
    case revision = "revision"
    case resetID = "reset_id"
  }
}

public struct TrackingEvent: Codable, Hashable, Sendable {
  public let schemaVersion: Int
  public let eventID: UUID
  public let deviceID: UUID
  public let sequence: Int64
  public let generation: ResetGeneration
  public let observedAtMS: Int64
  public let timezoneID: String
  public let transition: Transition
  public let isTest: Bool
  public let competitionEpochID: UUID?

  public init(
    schemaVersion: Int, eventID: UUID, deviceID: UUID, sequence: Int64, generation: ResetGeneration,
    observedAtMS: Int64, timezoneID: String, transition: Transition, isTest: Bool,
    competitionEpochID: UUID?
  ) {
    self.schemaVersion = schemaVersion
    self.eventID = eventID
    self.deviceID = deviceID
    self.sequence = sequence
    self.generation = generation
    self.observedAtMS = observedAtMS
    self.timezoneID = timezoneID
    self.transition = transition
    self.isTest = isTest
    self.competitionEpochID = competitionEpochID
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(schemaVersion, forKey: .schemaVersion)
    try container.encode(eventID.uuidString.lowercased(), forKey: .eventID)
    try container.encode(deviceID.uuidString.lowercased(), forKey: .deviceID)
    try container.encode(sequence, forKey: .sequence)
    try container.encode(generation, forKey: .generation)
    try container.encode(observedAtMS, forKey: .observedAtMS)
    try container.encode(timezoneID, forKey: .timezoneID)
    try container.encode(transition, forKey: .transition)
    try container.encode(isTest, forKey: .isTest)
    try container.encode(competitionEpochID?.uuidString.lowercased(), forKey: .competitionEpochID)
  }

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case eventID = "event_id"
    case deviceID = "device_id"
    case sequence = "sequence"
    case generation = "generation"
    case observedAtMS = "observed_at_ms"
    case timezoneID = "timezone_id"
    case transition = "transition"
    case isTest = "is_test"
    case competitionEpochID = "competition_epoch_id"
  }
}

public struct TrackingInterruption: Codable, Hashable, Sendable {
  public let interruptionID: UUID
  public let deviceID: UUID
  public let generation: ResetGeneration
  public let afterSequence: Int64
  public let reason: InterruptionReason
  public let observedAtMS: Int64

  public init(
    interruptionID: UUID, deviceID: UUID, generation: ResetGeneration, afterSequence: Int64,
    reason: InterruptionReason, observedAtMS: Int64
  ) {
    self.interruptionID = interruptionID
    self.deviceID = deviceID
    self.generation = generation
    self.afterSequence = afterSequence
    self.reason = reason
    self.observedAtMS = observedAtMS
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(interruptionID.uuidString.lowercased(), forKey: .interruptionID)
    try container.encode(deviceID.uuidString.lowercased(), forKey: .deviceID)
    try container.encode(generation, forKey: .generation)
    try container.encode(afterSequence, forKey: .afterSequence)
    try container.encode(reason, forKey: .reason)
    try container.encode(observedAtMS, forKey: .observedAtMS)
  }

  enum CodingKeys: String, CodingKey {
    case interruptionID = "interruption_id"
    case deviceID = "device_id"
    case generation = "generation"
    case afterSequence = "after_sequence"
    case reason = "reason"
    case observedAtMS = "observed_at_ms"
  }
}

extension ResetGeneration: Comparable {
  public static let initial = ResetGeneration(
    revision: 0, resetID: UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)))

  public static func < (lhs: Self, rhs: Self) -> Bool {
    if lhs.revision != rhs.revision { return lhs.revision < rhs.revision }
    return lhs.resetID.uuidString < rhs.resetID.uuidString
  }
}
