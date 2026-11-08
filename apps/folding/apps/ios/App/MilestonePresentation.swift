import FoldingDomain
import Foundation

extension FoldingPresentation {
  func invalidateMilestones() {
    milestonesContext = UUID()
    ownerMilestones = nil
    milestonesLoading = false
    milestonesFailed = false
    milestonesCached = false
    milestonesSaving = false
    milestonesFeatureFailed = false
    milestonesLastLoaded = nil
    milestonesSeen = []
    milestonesDisplayed = []
    if case .milestoneUnlock = sheet { sheet = nil }
  }

  func requestMilestones(using actions: FoldingActions, force: Bool = false) async {
    guard competitionJoined, competitionRemoval == nil, !entryDeletionPending,
      syncStatus?.resetPending != true,
      let load = actions.loadOwnerMilestones, !milestonesLoading
    else { return }
    if !force, let last = milestonesLastLoaded, Date.now.timeIntervalSince(last) < 30 { return }
    let context = milestonesContext
    milestonesLoading = true
    milestonesFailed = false
    defer { if context == milestonesContext { milestonesLoading = false } }
    do {
      let loaded = try await load()
      guard context == milestonesContext, competitionJoined, !Task.isCancelled else { return }
      guard loaded.snapshot.revision >= (ownerMilestones?.revision ?? -1) else { return }
      ownerMilestones = loaded.snapshot
      milestonesCached = !loaded.confirmed
      milestonesLastLoaded = Date.now
      presentMilestoneUnlockIfSafe()
    } catch is CancellationError {} catch {
      guard context == milestonesContext else { return }
      milestonesFailed = true
    }
  }

  var milestonePresentationTrigger: String {
    let awards =
      ownerMilestones?.grants.filter { !$0.acknowledged && !milestonesSeen.contains($0.badgeID) }
      .map(\.badgeID.rawValue).joined(separator: ",") ?? ""
    return
      "\(milestonesForeground)-\(competitionJoined)-\(milestonesCached)-\(needsSetup)-\(showInitialSetup)-\(sheet?.id ?? "")-\(operation ?? "")-\(error ?? "")-\(personalFailure ?? "")-\(milestonesSaving)-\(awards)"
  }
  func presentMilestoneUnlockIfSafe() {
    guard milestonesForeground, competitionJoined, !milestonesCached,
      !needsSetup, !showInitialSetup, sheet == nil, operation == nil, error == nil,
      personalFailure == nil, competitionRemoval == nil, !milestonesSaving,
      syncStatus?.resetPending != true, !entryDeletionPending,
      let ownerMilestones
    else { return }
    let badges = ownerMilestones.grants.filter {
      !$0.acknowledged && !milestonesSeen.contains($0.badgeID)
    }.map(\.badgeID)
    guard !badges.isEmpty else { return }
    sheet = .milestoneUnlock(badges)
  }
  func didShowMilestoneUnlock(_ badges: [MilestoneBadge]) {
    milestonesDisplayed = badges
    milestonesSeen.formUnion(badges)
  }
  func dismissMilestoneUnlock(using actions: FoldingActions) async {
    let badges = milestonesDisplayed
    milestonesDisplayed = []
    guard !badges.isEmpty, let participant = competitionProfile?.id,
      let value = ownerMilestones, let acknowledge = actions.acknowledgeMilestones
    else { return }
    let context = milestonesContext
    let request = MilestoneAcknowledgmentRequest(
      operationID: UUID().uuidString.lowercased(), generation: value.generation, badgeIDs: badges)
    // The service acknowledgment is retryable; local presentation remains suppressed
    // in this session even when the connection is lost after dismissal.
    var acknowledged = value
    for index in acknowledged.grants.indices
    where badges.contains(acknowledged.grants[index].badgeID) {
      acknowledged.grants[index].acknowledged = true
    }
    ownerMilestones = acknowledged
    do { try await acknowledge(participant, request) } catch {
      guard context == milestonesContext else { return }
    }
  }
  func featureMilestone(_ badge: MilestoneBadge?, using actions: FoldingActions) async {
    guard let value = ownerMilestones, let participant = competitionProfile?.id,
      let feature = actions.featureMilestone, !milestonesSaving,
      !milestonesCached, syncStatus?.resetPending != true, !entryDeletionPending
    else { return }
    let context = milestonesContext
    milestonesSaving = true
    milestonesFeatureFailed = false
    defer { if context == milestonesContext { milestonesSaving = false } }
    do {
      let confirmed = try await feature(participant, badge, value.generation)
      guard context == milestonesContext, confirmed.revision >= (ownerMilestones?.revision ?? -1)
      else { return }
      ownerMilestones = confirmed
      milestonesLastLoaded = Date.now
    } catch {
      guard context == milestonesContext else { return }
      milestonesFeatureFailed = true
    }
  }
}
