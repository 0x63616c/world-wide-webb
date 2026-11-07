import Foundation

public enum TrackingError: Error, Equatable {
  case invalidEnvelope
  case identityConflict
  case sequenceConflict
}

public enum SessionCompleteness: String, Codable, Sendable {
  case complete, candidate, incomplete, running
}

public struct TrackingSession: Equatable, Sendable {
  public let deviceID: UUID
  public let generation: ResetGeneration
  public let startMS: Int64
  public let endMS: Int64?
  public let durationMS: Int64?
  public let completeness: SessionCompleteness
}

public struct TrackingSummary: Equatable, Sendable {
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
  public static let version = 1
  public static let maximumInteger: Int64 = 9_007_199_254_740_991

  private struct Source: Hashable {
    let deviceID: UUID
    let generation: ResetGeneration
  }

  public static func reduce(
    events: [TrackingEvent], interruptions: [TrackingInterruption] = [],
    generation: ResetGeneration
  ) throws -> TrackingSummary {
    var byID: [UUID: TrackingEvent] = [:]
    var bySource: [Source: [Int64: TrackingEvent]] = [:]
    for event in events {
      guard event.schemaVersion == 1,
        (1...maximumInteger).contains(event.sequence),
        (0...maximumInteger).contains(event.observedAtMS),
        valid(event.generation), !event.timezoneID.isEmpty,
        event.timezoneID.count <= 100
      else { throw TrackingError.invalidEnvelope }
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
      var last: Transition?
      var active: (start: Int64, candidate: Bool)?

      func finish(end: Int64?, completeness: SessionCompleteness) {
        guard let session = active else { return }
        let duration =
          completeness == .complete || completeness == .candidate
          ? end.map { $0 - session.start } : nil
        result.sessions.append(
          TrackingSession(
            deviceID: source.deviceID, generation: source.generation,
            startMS: session.start, endMS: end, durationMS: duration,
            completeness: completeness))

        active = nil
      }

      for event in ordered {
        while markerIndex < markers.count && markers[markerIndex] < event.sequence {
          finish(end: nil, completeness: .incomplete)
          markerIndex += 1
        }
        if event.isTest { continue }
        switch event.transition {
        case .open:
          if last == .open {
            finish(end: nil, completeness: .incomplete)
            active = (event.observedAtMS, true)
          } else {
            result.opens += 1
            active = (event.observedAtMS, false)
          }
        case .close:
          if last != .close { result.closes += 1 }
          if let session = active {
            if event.observedAtMS < session.start {
              finish(end: event.observedAtMS, completeness: .incomplete)
            } else {
              if !session.candidate { result.cycles += 1 }
              finish(
                end: event.observedAtMS,
                completeness: session.candidate ? .candidate : .complete)
            }
          }
        }
        last = event.transition
      }
      if markerIndex < markers.count { finish(end: nil, completeness: .incomplete) }
      finish(end: nil, completeness: .running)
    }
    for session in result.sessions {
      guard let duration = session.durationMS else { continue }
      let (sum, overflow) = result.completeDurationMS.addingReportingOverflow(duration)
      guard !overflow else { throw TrackingError.invalidEnvelope }
      result.completeDurationMS = sum
    }
    return result
  }

  private static func valid(_ generation: ResetGeneration) -> Bool {
    (0...maximumInteger).contains(generation.revision)
      && (generation.revision != 0 || generation == .initial)
      && (generation.revision == 0 || generation.resetID != ResetGeneration.initial.resetID)
  }
}
