import FoldingData
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

  func testCacheAndRetryIntentsNeverCrossAccountOrReset() throws {
    let suite = "folding.milestones.test.\(UUID())"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let value = try fixture().owner
    let participant = UUID().uuidString
    let cache = MilestoneCache(defaults: defaults)
    try cache.save(value, participant: participant)
    let pending = cache.feature(
      participant: participant, generation: value.generation, badge: .folds1)
    try cache.queue(pending, participant: participant)
    let reopened = MilestoneCache(defaults: defaults)
    XCTAssertEqual(
      reopened.feature(participant: participant, generation: value.generation, badge: .folds1)
        .operationID, pending.operationID)
    let ack = MilestoneAcknowledgmentRequest(
      operationID: UUID().uuidString, generation: value.generation, badgeIDs: [.folds100])
    try cache.queue(ack, participant: participant)
    try cache.queue(ack, participant: participant)
    XCTAssertEqual(
      reopened.acknowledgments(participant: participant, generation: value.generation).count, 1)
    try reopened.acknowledged(ack, participant: participant)
    XCTAssertTrue(
      try XCTUnwrap(reopened.snapshot(participant: participant, generation: value.generation))
        .grants.first(where: { $0.badgeID == .folds100 })!.acknowledged)
    XCTAssertNil(reopened.snapshot(participant: "another-account", generation: value.generation))
    XCTAssertNil(cache.snapshot(participant: participant, generation: value.generation))
    try cache.save(value, participant: participant)
    let reset = ResetGeneration(revision: 1, resetID: UUID())
    XCTAssertNil(cache.snapshot(participant: participant, generation: reset))
    XCTAssertTrue(cache.acknowledgments(participant: participant, generation: reset).isEmpty)
  }

  func testFeaturingFailureKeepsConfirmedSelectionAndOfflineSelectionIsDisabled() async throws {
    let model = FoldingPresentation()
    model.competitionJoined = true
    model.competitionProfile = CompetitionProfile(
      id: "owner", nickname: "Folder", approvedAvatarURL: nil, avatarState: .none)
    model.ownerMilestones = try fixture().owner
    var called = 0
    var actions = basicActions()
    actions.featureMilestone = { _, _, _ in
      called += 1
      throw URLError(.notConnectedToInternet)
    }
    await model.featureMilestone(.folds1, using: actions)
    XCTAssertEqual(model.ownerMilestones?.featuredBadgeID, .folds100)
    XCTAssertTrue(model.milestonesFeatureFailed)
    XCTAssertFalse(model.milestonesSaving)
    model.milestonesCached = true
    await model.featureMilestone(.folds1, using: actions)
    XCTAssertEqual(called, 1)
  }

  func testDelayedOwnerReadCannotPublishAfterAnAccountFence() async throws {
    let model = FoldingPresentation()
    model.competitionJoined = true
    var continuation: CheckedContinuation<MilestoneOwnerLoad, Error>?
    var actions = basicActions()
    actions.loadOwnerMilestones = {
      try await withCheckedThrowingContinuation { continuation = $0 }
    }
    let task = Task { await model.requestMilestones(using: actions, force: true) }
    while continuation == nil { await Task.yield() }
    model.invalidateMilestones()
    continuation!.resume(
      returning: MilestoneOwnerLoad(snapshot: try fixture().owner, confirmed: true))
    await task.value
    XCTAssertNil(model.ownerMilestones)
    XCTAssertFalse(model.milestonesLoading)
  }

  func testUnlocksGroupOnlyAtSafeForegroundAndFailedAcknowledgmentDoesNotRepeat() async throws {
    let model = FoldingPresentation()
    model.competitionJoined = true
    model.competitionProfile = CompetitionProfile(
      id: "owner", nickname: "Folder", approvedAvatarURL: nil, avatarState: .none)
    var owner = try fixture().owner
    for index in owner.grants.indices { owner.grants[index].acknowledged = false }
    model.ownerMilestones = owner
    let setup: [String: Any] = [
      "schemaVersion": 1, "flowID": UUID().uuidString, "deviceID": UUID().uuidString,
      "generation": ["revision": 0, "reset_id": UUID().uuidString], "step": "complete",
    ]
    model.setup = try JSONDecoder().decode(
      SetupProgress.self, from: JSONSerialization.data(withJSONObject: setup))
    model.presentMilestoneUnlockIfSafe()
    XCTAssertNil(model.sheet)
    model.milestonesForeground = true
    model.sheet = .settings
    model.presentMilestoneUnlockIfSafe()
    XCTAssertEqual(model.sheet, .settings)
    model.sheet = nil
    model.error = "Busy"
    model.presentMilestoneUnlockIfSafe()
    XCTAssertNil(model.sheet)
    model.error = nil
    model.presentMilestoneUnlockIfSafe()
    let badges = owner.grants.map(\.badgeID)
    XCTAssertEqual(model.sheet, .milestoneUnlock(badges))
    model.didShowMilestoneUnlock(badges)
    model.sheet = nil
    var acknowledged: [MilestoneBadge] = []
    var actions = basicActions()
    actions.acknowledgeMilestones = { _, request in
      acknowledged = request.badgeIDs
      throw URLError(.notConnectedToInternet)
    }
    await model.dismissMilestoneUnlock(using: actions)
    XCTAssertEqual(acknowledged, badges)
    // An unchanged server response must not replay it in this session.
    model.ownerMilestones = owner
    model.presentMilestoneUnlockIfSafe()
    XCTAssertNil(model.sheet)
    XCTAssertEqual(model.milestonesSeen, Set(badges))
  }

  func testOlderResponseCannotOverwriteAConfirmedFeatureOrItsCache() async throws {
    let current = try fixture().owner
    let old = OwnerMilestones(
      generation: current.generation, revision: current.revision - 1,
      progress: current.progress, grants: current.grants, featuredBadgeID: .folds1)
    let suite = "folding.milestones.order.\(UUID())"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let cache = MilestoneCache(defaults: defaults)
    try cache.save(current, participant: "owner")
    try cache.save(old, participant: "owner")
    XCTAssertEqual(
      cache.snapshot(participant: "owner", generation: current.generation)?.featuredBadgeID,
      .folds100)
    let model = FoldingPresentation()
    model.competitionJoined = true
    model.ownerMilestones = current
    var actions = basicActions()
    actions.loadOwnerMilestones = { MilestoneOwnerLoad(snapshot: old, confirmed: true) }
    await model.requestMilestones(using: actions, force: true)
    XCTAssertEqual(model.ownerMilestones?.revision, current.revision)
    XCTAssertEqual(model.ownerMilestones?.featuredBadgeID, .folds100)
  }

  private func basicActions() -> FoldingActions {
    FoldingActions(
      refresh: {}, setup: { _ in throw CancellationError() }, savePreferences: { _ in })
  }
}
