import FoldingDomain
import Foundation

enum MilestoneBadge: String, Codable, CaseIterable, Identifiable, Sendable {
  case folds1 = "folds_1"
  case folds100 = "folds_100"
  case folds1000 = "folds_1000"
  case folds10000 = "folds_10000"
  case days7 = "days_7"
  case days30 = "days_30"

  var id: String { rawValue }
  var track: MilestoneTrack {
    switch self {
    case .folds1, .folds100, .folds1000, .folds10000: .folds
    case .days7, .days30: .days
    }
  }
  var threshold: Int {
    switch self {
    case .folds1: 1
    case .folds100: 100
    case .folds1000: 1_000
    case .folds10000: 10_000
    case .days7: 7
    case .days30: 30
    }
  }
}

enum MilestoneTrack: String, Codable, CaseIterable, Sendable { case folds, days }

struct NextMilestone: Codable, Hashable, Identifiable, Sendable {
  let track: MilestoneTrack
  let badgeID: MilestoneBadge
  let current: Int
  let target: Int
  var id: String { track.rawValue }
  var fraction: Double { min(1, max(0, Double(current) / Double(max(1, target)))) }
  enum CodingKeys: String, CodingKey {
    case track
    case badgeID = "badge_id"
    case current, target
  }
}

struct MilestoneProgress: Codable, Equatable, Sendable {
  let catalogVersion: Int
  let folds: Int
  let daysUsed: Int
  let next: [NextMilestone]
  let earned: [MilestoneBadge]
  enum CodingKeys: String, CodingKey {
    case catalogVersion = "catalog_version"
    case folds
    case daysUsed = "days_used"
    case next, earned
  }

  func validate() throws {
    guard catalogVersion == 1, (0...9_007_199_254_740_991).contains(folds),
      (0...folds).contains(daysUsed), folds == 0 || daysUsed > 0
    else { throw CompetitionTransportError.invalidResponse }
    let expected = MilestoneBadge.allCases.filter {
      ($0.track == .folds ? folds : daysUsed) >= $0.threshold
    }
    guard Set(earned) == Set(expected), Set(earned).count == earned.count else {
      throw CompetitionTransportError.invalidResponse
    }
    let expectedNext = MilestoneTrack.allCases.compactMap { track in
      MilestoneBadge.allCases.first { $0.track == track && !expected.contains($0) }
    }
    guard next.map(\.badgeID) == expectedNext else {
      throw CompetitionTransportError.invalidResponse
    }
    for item in next {
      guard item.track == item.badgeID.track, item.target == item.badgeID.threshold,
        item.current == (item.track == .folds ? folds : daysUsed)
      else { throw CompetitionTransportError.invalidResponse }
    }
  }
}

struct EarnedMilestone: Codable, Hashable, Identifiable, Sendable {
  let badgeID: MilestoneBadge
  let earnedAtMS: Int64?
  var acknowledged: Bool
  var id: String { badgeID.id }
  enum CodingKeys: String, CodingKey {
    case badgeID = "badge_id"
    case earnedAtMS = "earned_at_ms"
    case acknowledged
  }
}

struct OwnerMilestones: Codable, Sendable {
  let generation: ResetGeneration
  let revision: Int64
  let progress: MilestoneProgress
  var grants: [EarnedMilestone]
  let featuredBadgeID: MilestoneBadge?
  enum CodingKeys: String, CodingKey {
    case generation, revision, progress, grants
    case featuredBadgeID = "featured_badge_id"
  }
  func validate() throws {
    try progress.validate()
    guard (0...9_007_199_254_740_991).contains(revision),
      (0...9_007_199_254_740_991).contains(generation.revision),
      Set(grants.map(\.badgeID)) == Set(progress.earned),
      grants.count == progress.earned.count,
      grants.allSatisfy({ ($0.earnedAtMS ?? 0) >= 0 }),
      featuredBadgeID.map({ progress.earned.contains($0) }) ?? true
    else { throw CompetitionTransportError.invalidResponse }
  }
}

struct ParticipantProfile: Codable, Sendable {
  let participantID: String
  let nickname: String
  let avatarID: String?
  let folds: Int
  let earnedBadges: [MilestoneBadge]
  let featuredBadgeID: MilestoneBadge?
  enum CodingKeys: String, CodingKey {
    case participantID = "participant_id"
    case nickname
    case avatarID = "avatar_id"
    case folds
    case earnedBadges = "earned_badges"
    case featuredBadgeID = "featured_badge_id"
  }
  func validate() throws {
    guard UUID(uuidString: participantID) != nil,
      avatarID.map({ UUID(uuidString: $0) != nil }) ?? true,
      (0...9_007_199_254_740_991).contains(folds),
      Set(earnedBadges).count == earnedBadges.count,
      featuredBadgeID.map({ earnedBadges.contains($0) }) ?? true
    else { throw CompetitionTransportError.invalidResponse }
  }
}

struct ParticipantProfileResponse: Decodable, Sendable {
  let profile: ParticipantProfile
  let revision: Int64
}

struct FeaturedBadgeRequest: Codable, Sendable {
  let operationID: String
  let generation: ResetGeneration
  let badgeID: MilestoneBadge?
  enum CodingKeys: String, CodingKey {
    case operationID = "operation_id"
    case generation
    case badgeID = "badge_id"
  }
  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(operationID, forKey: .operationID)
    try values.encode(generation, forKey: .generation)
    try values.encode(badgeID, forKey: .badgeID)
  }
}
struct FeaturedBadgeResponse: Decodable, Sendable {
  let featuredBadgeID: MilestoneBadge?
  enum CodingKeys: String, CodingKey { case featuredBadgeID = "featured_badge_id" }
}
struct MilestoneAcknowledgmentRequest: Codable, Sendable {
  let operationID: String
  let generation: ResetGeneration
  let badgeIDs: [MilestoneBadge]
  enum CodingKeys: String, CodingKey {
    case operationID = "operation_id"
    case generation
    case badgeIDs = "badge_ids"
  }
}
