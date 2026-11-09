import Foundation

public struct SessionDeletionTarget: Codable, Hashable, Sendable {
  public let deviceID: UUID
  public let generation: ResetGeneration
  public let startMS: Int64
  public let endMS: Int64?
  public let openingEventID: UUID?
  public init(_ session: TrackingSession) {
    deviceID = session.deviceID
    generation = session.generation
    startMS = session.startMS
    endMS = session.endMS
    openingEventID = session.openingEventID
  }
  public func matches(_ session: TrackingSession) -> Bool {
    deviceID == session.deviceID && generation == session.generation && startMS == session.startMS
      && (openingEventID == nil || openingEventID == session.openingEventID)
  }
}

/// Immutable, replicated user intent. Keep causal observations for deduplication, but never
/// count/export their deleted contributions or resurrect the associated session after late input.
public struct TrackingDeletion: Codable, Equatable, Sendable {
  public let deletionID: UUID
  public let target: SessionDeletionTarget
  public let eventIDs: [UUID]
  public let createdAtMS: Int64
  public let participantID: String?
  public let epochIDs: [UUID]
  public init(
    deletionID: UUID = UUID(), target: SessionDeletionTarget, eventIDs: [UUID],
    createdAtMS: Int64, participantID: String?, epochIDs: [UUID] = []
  ) {
    self.deletionID = deletionID
    self.target = target
    self.eventIDs = eventIDs.sorted { $0.uuidString < $1.uuidString }
    self.createdAtMS = createdAtMS
    self.participantID = participantID
    self.epochIDs = epochIDs.sorted { $0.uuidString < $1.uuidString }
  }
  public func validate() throws {
    _ = try TrackingReducer.reduce(events: [], generation: target.generation)
    guard (1...2).contains(eventIDs.count), Set(eventIDs).count == eventIDs.count,
      (0...TrackingReducer.maximumInteger).contains(createdAtMS),
      (0...TrackingReducer.maximumInteger).contains(target.startMS),
      target.endMS.map({ (0...TrackingReducer.maximumInteger).contains($0) }) ?? true,
      target.generation.revision >= 0,
      target.openingEventID.map({ eventIDs.contains($0) }) ?? true,
      epochIDs.count <= 2, Set(epochIDs).count == epochIDs.count,
      participantID.map({ UUID(uuidString: $0) != nil }) ?? true
    else { throw TrackingError.invalidEnvelope }
  }
}

public struct TrackingSessionIdentity: Hashable, Sendable {
  let deviceID: UUID
  let generation: ResetGeneration
  let startMS: Int64
  public init(_ session: TrackingSession) {
    deviceID = session.deviceID
    generation = session.generation
    startMS = session.startMS
  }
  public init(_ target: SessionDeletionTarget) {
    deviceID = target.deviceID
    generation = target.generation
    startMS = target.startMS
  }
}
