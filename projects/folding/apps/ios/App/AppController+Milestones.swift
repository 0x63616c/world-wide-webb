import FoldingDomain
import Foundation

extension AppController {
  func flushMilestoneAcknowledgments(participant: String, generation: ResetGeneration)
    async throws
  {
    let identity = competitionIdentityRevision
    let api = try await competitionClient()
    guard identity == competitionIdentityRevision, participant == joinedParticipantID else {
      throw CancellationError()
    }
    for request in milestoneCache.acknowledgments(participant: participant, generation: generation)
    {
      let before = try await runtime.store().currentGeneration()
      guard identity == competitionIdentityRevision, participant == joinedParticipantID,
        before == generation
      else { throw CancellationError() }
      do { try await api.acknowledgeMilestones(request) } catch let failure
        as CompetitionTransportError where failure.statusCode == 422
      {
        // A corrected/revoked grant no longer needs an unlock acknowledgment.
      }
      let after = try await runtime.store().currentGeneration()
      guard identity == competitionIdentityRevision, participant == joinedParticipantID,
        after == generation
      else { throw CancellationError() }
      try milestoneCache.acknowledged(request, participant: participant)
    }
  }

  func loadOwnerMilestones() async throws -> MilestoneOwnerLoad {
    guard let participant = joinedParticipantID else {
      throw CompetitionTransportError.unauthorized
    }
    let identity = competitionIdentityRevision
    let store = try await runtime.store()
    let generation = try await store.currentGeneration()
    let deletionPending = try await store.hasPendingEntryDeletions()
    let resetPending = try await runtime.syncStatus(refresh: false).resetPending
    guard identity == competitionIdentityRevision, participant == joinedParticipantID else {
      throw CancellationError()
    }
    guard !deletionPending, !resetPending else {
      milestoneCache.clear()
      throw CancellationError()
    }
    do {
      try? await flushMilestoneAcknowledgments(participant: participant, generation: generation)
      let value = try await competitionClient().milestones()
      let confirmedGeneration = try await store.currentGeneration()
      guard identity == competitionIdentityRevision, participant == joinedParticipantID,
        confirmedGeneration == generation
      else { throw CancellationError() }
      guard value.generation == generation else {
        milestoneCache.clear()
        throw CancellationError()
      }
      try milestoneCache.save(value, participant: participant)
      return MilestoneOwnerLoad(
        snapshot: suppressPendingUnlocks(value, participant: participant), confirmed: true)
    } catch {
      let failedGeneration = try await store.currentGeneration()
      guard identity == competitionIdentityRevision, participant == joinedParticipantID,
        failedGeneration == generation
      else { throw CancellationError() }
      let permitsCache: Bool
      if error is URLError {
        permitsCache = true
      } else if let transport = error as? CompetitionTransportError {
        permitsCache =
          transport.statusCode.map { $0 >= 500 || $0 == 429 }
          ?? {
            if case .unavailable = transport { return true }
            return false
          }()
      } else {
        permitsCache = false
      }
      if permitsCache,
        let cached = milestoneCache.snapshot(participant: participant, generation: generation)
      {
        return MilestoneOwnerLoad(
          snapshot: suppressPendingUnlocks(cached, participant: participant), confirmed: false)
      }
      if let failure = error as? CompetitionTransportError,
        [401, 403, 404, 409].contains(failure.statusCode ?? 0)
      {
        milestoneCache.clear()
        presentation.invalidateMilestones()
      }
      throw error
    }
  }

  private func suppressPendingUnlocks(_ snapshot: OwnerMilestones, participant: String)
    -> OwnerMilestones
  {
    let pending = Set(
      milestoneCache.acknowledgments(participant: participant, generation: snapshot.generation)
        .flatMap(\.badgeIDs))
    var value = snapshot
    for index in value.grants.indices where pending.contains(value.grants[index].badgeID) {
      value.grants[index].acknowledged = true
    }
    return value
  }
}
