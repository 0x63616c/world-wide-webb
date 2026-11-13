import Foundation

public enum TrackingError: Error, Equatable {
  case invalidEnvelope
  case identityConflict
  case sequenceConflict
}

public enum SessionCompleteness: String, Codable, Sendable {
  case complete, candidate, incomplete, running
}

public struct TrackingSession: Codable, Equatable, Sendable {
  public let deviceID: UUID
  public let generation: ResetGeneration
  public let startMS: Int64
  public let endMS: Int64?
  public let durationMS: Int64?
  public let completeness: SessionCompleteness
  public let openingEventID: UUID?
  public init(
    deviceID: UUID, generation: ResetGeneration, startMS: Int64, endMS: Int64?,
    durationMS: Int64?, completeness: SessionCompleteness, openingEventID: UUID? = nil
  ) {
    self.deviceID = deviceID
    self.generation = generation
    self.startMS = startMS
    self.endMS = endMS
    self.durationMS = durationMS
    self.completeness = completeness
    self.openingEventID = openingEventID
  }
}

public struct TrackingSummary: Codable, Equatable, Sendable {
  public internal(set) var opens = 0
  public internal(set) var closes = 0
  public internal(set) var cycles = 0
  public internal(set) var completeDurationMS: Int64 = 0
  public internal(set) var sessions: [TrackingSession] = []
  public var folds: Int { opens + closes }
  public var incompleteSessions: Int { sessions.filter { $0.completeness == .incomplete }.count }
  public var equivalentDegrees: Double { Double(folds) * 180 }
  public var equivalentMetres: Double { Double(folds) * .pi * 0.1 }
}

/// Replays immutable observations. Persistence and calendar aggregation are separate operations.
public enum TrackingReducer {
  public static let version = 2
  public static let maximumInteger: Int64 = 9_007_199_254_740_991

  private struct Source: Hashable {
    let deviceID: UUID
    let generation: ResetGeneration
  }

  public static func reduce(
    events: [TrackingEvent], interruptions: [TrackingInterruption] = [],
    generation: ResetGeneration, deletions: [TrackingDeletion] = []
  ) throws -> TrackingSummary {
    for deletion in deletions { try deletion.validate() }
    let activeDeletions = deletions.filter { $0.target.generation == generation }
    let deletedIDs = Set(activeDeletions.flatMap(\.eventIDs))
    let deletedSessions = Set(activeDeletions.map { TrackingSessionIdentity($0.target) })
    func visible(_ session: TrackingSession) -> Bool {
      if let openingID = session.openingEventID { return !deletedIDs.contains(openingID) }
      return !deletedSessions.contains(TrackingSessionIdentity(session))
    }
    var byID: [UUID: TrackingEvent] = [:]
    var bySource: [Source: [Int64: TrackingEvent]] = [:]
    for event in events {
      try validate(event)
      if let old = byID[event.eventID] {
        guard old == event else { throw TrackingError.identityConflict }
        continue
      }
      byID[event.eventID] = event
      let source = Source(deviceID: event.deviceID, generation: event.generation)
      guard bySource[source]?[event.sequence] == nil else { throw TrackingError.sequenceConflict }
      bySource[source, default: [:]][event.sequence] = event
    }
    var interruptionIDs: [UUID: TrackingInterruption] = [:]
    for marker in interruptions {
      guard (0...maximumInteger).contains(marker.afterSequence),
        (0...maximumInteger).contains(marker.observedAtMS), valid(marker.generation)
      else { throw TrackingError.invalidEnvelope }
      if let old = interruptionIDs[marker.interruptionID], old != marker {
        throw TrackingError.identityConflict
      }
      interruptionIDs[marker.interruptionID] = marker
    }
    guard valid(generation) else { throw TrackingError.invalidEnvelope }
    var result = TrackingSummary()
    // Stable output order across dictionary iteration and sync arrival order.
    let sources = bySource.keys.filter { $0.generation == generation }.sorted {
      $0.deviceID.uuidString < $1.deviceID.uuidString
    }
    for source in sources {
      let ordered = bySource[source]!.values.sorted { $0.sequence < $1.sequence }
      let markers = Set(
        interruptionIDs.values.filter {
          $0.deviceID == source.deviceID && $0.generation == source.generation
        }.map(\.afterSequence)
      ).sorted()
      var markerIndex = 0
      var checkpoint = TrackingCheckpoint(deviceID: source.deviceID, generation: source.generation)
      for event in ordered {
        while markerIndex < markers.count && markers[markerIndex] < event.sequence {
          if let session = checkpoint.interrupt(), visible(session) {
            result.sessions.append(session)
          }
          markerIndex += 1
        }
        let delta = try checkpoint.append(event)
        if !deletedIDs.contains(event.eventID) {
          result.opens += delta.opens
          result.closes += delta.closes
        }
        if let session = delta.finishedSession, visible(session) {
          result.cycles += delta.cycles
          result.sessions.append(session)
        }
      }
      if markerIndex < markers.count, let session = checkpoint.interrupt(), visible(session) {
        result.sessions.append(session)
      }
      if let session = checkpoint.runningSession, visible(session) {
        result.sessions.append(session)
      }
    }
    for session in result.sessions {
      guard let duration = session.durationMS else { continue }
      let (sum, overflow) = result.completeDurationMS.addingReportingOverflow(duration)
      guard !overflow else { throw TrackingError.invalidEnvelope }
      result.completeDurationMS = sum
    }
    return result
  }

  static func validate(_ event: TrackingEvent) throws {
    guard event.schemaVersion == 1,
      (1...maximumInteger).contains(event.sequence),
      (0...maximumInteger).contains(event.observedAtMS),
      valid(event.generation), !event.timezoneID.isEmpty,
      event.timezoneID.count <= 100, TimeZone(identifier: event.timezoneID) != nil,
      !(event.timezoneID.hasPrefix("GMT+") || event.timezoneID.hasPrefix("GMT-"))
        || TimeZone(identifier: event.timezoneID)?.identifier == event.timezoneID
    else { throw TrackingError.invalidEnvelope }
  }

  private static func valid(_ generation: ResetGeneration) -> Bool {
    (0...maximumInteger).contains(generation.revision)
      && (generation.revision != 0 || generation == .initial)
      && (generation.revision == 0 || generation.resetID != ResetGeneration.initial.resetID)
  }
}
