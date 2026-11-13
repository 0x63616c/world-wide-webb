import FoldingDomain
import Foundation

/// Confirmed projections and retry intents, fenced by participant and reset.
@MainActor final class MilestoneCache {
  private struct Entry: Codable {
    let participantID: String
    let generation: ResetGeneration
    var snapshot: OwnerMilestones?
    var acknowledgments: [MilestoneAcknowledgmentRequest]
    var feature: FeaturedBadgeRequest?
  }
  private let defaults: UserDefaults
  private let key = "folding.milestones.owner.v1"
  init(defaults: UserDefaults) { self.defaults = defaults }
  private func entry(_ participant: String, _ generation: ResetGeneration) -> Entry {
    if let data = defaults.data(forKey: key),
      let entry = try? JSONDecoder().decode(Entry.self, from: data),
      entry.participantID == participant, entry.generation == generation
    {
      return entry
    }
    clear()
    return Entry(participantID: participant, generation: generation, acknowledgments: [])
  }
  private func save(_ entry: Entry) throws {
    defaults.set(try JSONEncoder().encode(entry), forKey: key)
  }
  func clear() { defaults.removeObject(forKey: key) }
  func snapshot(participant: String, generation: ResetGeneration) -> OwnerMilestones? {
    guard let value = entry(participant, generation).snapshot,
      value.generation == generation, (try? value.validate()) != nil
    else { return nil }
    return value
  }
  func save(_ snapshot: OwnerMilestones, participant: String) throws {
    try snapshot.validate()
    var entry = entry(participant, snapshot.generation)
    if let previous = entry.snapshot, previous.revision > snapshot.revision { return }
    entry.snapshot = snapshot
    try save(entry)
  }
  func acknowledgments(participant: String, generation: ResetGeneration)
    -> [MilestoneAcknowledgmentRequest]
  { entry(participant, generation).acknowledgments }
  func queue(_ request: MilestoneAcknowledgmentRequest, participant: String) throws {
    var entry = entry(participant, request.generation)
    if !entry.acknowledgments.contains(where: { $0.operationID == request.operationID }) {
      entry.acknowledgments.append(request)
    }
    try save(entry)
  }
  func acknowledged(_ request: MilestoneAcknowledgmentRequest, participant: String) throws {
    var entry = entry(participant, request.generation)
    entry.acknowledgments.removeAll { $0.operationID == request.operationID }
    if var value = entry.snapshot {
      for index in value.grants.indices where request.badgeIDs.contains(value.grants[index].badgeID)
      {
        value.grants[index].acknowledged = true
      }
      entry.snapshot = value
    }
    try save(entry)
  }
  func feature(participant: String, generation: ResetGeneration, badge: MilestoneBadge?)
    -> FeaturedBadgeRequest
  {
    if let pending = entry(participant, generation).feature, pending.badgeID == badge {
      return pending
    }
    return FeaturedBadgeRequest(
      operationID: UUID().uuidString.lowercased(), generation: generation, badgeID: badge)
  }
  func queue(_ request: FeaturedBadgeRequest, participant: String) throws {
    var entry = entry(participant, request.generation)
    entry.feature = request
    try save(entry)
  }
  func featured(_ request: FeaturedBadgeRequest, participant: String) throws {
    var entry = entry(participant, request.generation)
    if entry.feature?.operationID == request.operationID { entry.feature = nil }
    try save(entry)
  }
}
struct MilestoneOwnerLoad: Sendable {
  let snapshot: OwnerMilestones
  let confirmed: Bool
}
struct ParticipantProfileLoad: Sendable {
  let profile: ParticipantProfileResponse
  let avatarData: Data?
}
