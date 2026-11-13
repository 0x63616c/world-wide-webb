import Foundation

/// Durable source state shared by full replay and append-only cache updates.
public struct TrackingCheckpoint: Codable, Sendable {
  public let schemaVersion: Int
  public let deviceID: UUID
  public let generation: ResetGeneration
  public private(set) var sequence: Int64 = 0
  private var last: Transition?
  private var activeStartMS: Int64?
  private var activeOpeningEventID: UUID?
  private var candidate = false

  public init(deviceID: UUID, generation: ResetGeneration) {
    self.schemaVersion = 1
    self.deviceID = deviceID
    self.generation = generation
  }

  public var runningSession: TrackingSession? {
    activeStartMS.map {
      TrackingSession(
        deviceID: deviceID, generation: generation,
        startMS: $0, endMS: nil, durationMS: nil, completeness: .running,
        openingEventID: activeOpeningEventID)
    }
  }

  public mutating func interrupt() -> TrackingSession? {
    guard let start = activeStartMS else { return nil }
    activeStartMS = nil
    let openingID = activeOpeningEventID
    activeOpeningEventID = nil
    return TrackingSession(
      deviceID: deviceID, generation: generation, startMS: start,
      endMS: nil, durationMS: nil, completeness: .incomplete, openingEventID: openingID)
  }

  public mutating func append(_ event: TrackingEvent) throws -> TrackingAppendResult {
    try TrackingReducer.validate(event)
    guard schemaVersion == 1, event.deviceID == deviceID, event.generation == generation,
      event.sequence > sequence
    else { throw TrackingError.sequenceConflict }
    sequence = event.sequence
    if event.isTest { return TrackingAppendResult() }
    var delta = TrackingAppendResult()
    if event.transition != last {
      if event.transition == .open { delta.opens = 1 } else { delta.closes = 1 }
    }
    switch event.transition {
    case .open:
      if last == .open { delta.finishedSession = interrupt() }
      activeStartMS = event.observedAtMS
      activeOpeningEventID = event.eventID
      candidate = last == .open
    case .close:
      if let start = activeStartMS {
        let completeness: SessionCompleteness =
          event.observedAtMS < start ? .incomplete : (candidate ? .candidate : .complete)
        let duration = completeness == .incomplete ? nil : event.observedAtMS - start
        delta.finishedSession = TrackingSession(
          deviceID: deviceID, generation: generation,
          startMS: start, endMS: event.observedAtMS, durationMS: duration,
          completeness: completeness, openingEventID: activeOpeningEventID)
        delta.cycles = completeness == .complete ? 1 : 0
        delta.completeDurationMS = duration ?? 0
        activeStartMS = nil
        activeOpeningEventID = nil
      }
    }
    last = event.transition
    return delta
  }
}

public struct TrackingAppendResult: Sendable {
  public internal(set) var opens = 0
  public internal(set) var closes = 0
  public internal(set) var cycles = 0
  public internal(set) var completeDurationMS: Int64 = 0
  public internal(set) var finishedSession: TrackingSession?
  public var counted: Bool { opens + closes > 0 }
}

extension TrackingAppendResult {
  public func applyingDeletions(to event: TrackingEvent, deletions: [TrackingDeletion]) -> Self {
    var result = self
    if deletions.contains(where: { $0.eventIDs.contains(event.eventID) }) {
      result.opens = 0
      result.closes = 0
    }
    if let session = finishedSession, deletions.contains(where: { $0.target.matches(session) }) {
      result.cycles = 0
      result.completeDurationMS = 0
      result.finishedSession = nil
    }
    return result
  }
}

extension TrackingAppendResult {
  public func suppressingDeleted(event: Bool, session: Bool) -> Self {
    var result = self
    if event {
      result.opens = 0
      result.closes = 0
    }
    if session {
      result.cycles = 0
      result.completeDurationMS = 0
      result.finishedSession = nil
    }
    return result
  }
}
