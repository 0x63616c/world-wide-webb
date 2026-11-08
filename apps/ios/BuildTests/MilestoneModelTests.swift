import FoldingDomain
import Foundation
import XCTest

@testable import Folding

@MainActor final class MilestoneModelTests: XCTestCase {
  private struct Fixture: Decodable {
    let owner: OwnerMilestones
    let publicProfile: ParticipantProfileResponse
    enum CodingKeys: String, CodingKey {
      case owner
      case publicProfile = "public_profile"
    }
  }
  private func fixture() throws -> Fixture {
    let url = try XCTUnwrap(
      Bundle(for: MilestoneModelTests.self).url(forResource: "milestones", withExtension: "json"))
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }
  func testSharedWireFixtureShowsOnlyTheNextTargets() throws {
    let value = try fixture()
    try value.owner.validate()
    try value.publicProfile.profile.validate()
    XCTAssertEqual(value.owner.progress.next.map(\.badgeID), [.folds1000, .days7])
    XCTAssertEqual(value.owner.progress.next.first?.fraction, 0.64)
    XCTAssertEqual(Set(value.owner.grants.map(\.badgeID)), [.folds1, .folds100])
    XCTAssertEqual(value.publicProfile.profile.featuredBadgeID, .folds100)
  }
  func testMalformedFutureTargetAndInvalidSelectedBadgeAreRejected() throws {
    let value = try fixture().owner
    let invalid = MilestoneProgress(
      catalogVersion: 1, folds: 640, daysUsed: 6,
      next: [NextMilestone(track: .folds, badgeID: .folds10000, current: 640, target: 10_000)],
      earned: [.folds1, .folds100])
    XCTAssertThrowsError(try invalid.validate())
    let unearned = OwnerMilestones(
      generation: value.generation, revision: value.revision, progress: value.progress,
      grants: value.grants, featuredBadgeID: .folds1000)
    XCTAssertThrowsError(try unearned.validate())
  }
  func testRemovingFeatureEncodesExplicitNullAndKeepsGenerationFence() throws {
    let value = try fixture().owner
    let request = FeaturedBadgeRequest(
      operationID: UUID().uuidString.lowercased(), generation: value.generation, badgeID: nil)
    let json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
    XCTAssertTrue(json["badge_id"] is NSNull)
    XCTAssertNotNil(json["generation"])
  }
}
