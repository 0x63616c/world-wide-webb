import FoldingDomain
import Foundation

extension AppController {
  private func deletionProof(using api: CompetitionAPI) async throws -> String {
    do {
      return try await appleSignIn.reauthenticate(transport: api.transport, deviceID: api.deviceID)
    } catch CompetitionTransportError.unauthorized {
      let participant = preferencesStore.string(forKey: "folding.competitionParticipantID")
      let recovered = try await appleSignIn.signIn(
        transport: api.transport, deviceID: api.deviceID,
        existingParticipantID: participant, existingAccountOnly: true)
      setCompetitionAccountExists(true, participantID: recovered.profile.participant_id)
      return try await appleSignIn.reauthenticate(transport: api.transport, deviceID: api.deviceID)
    }
  }

  func beginAccountDeletion() async throws {
    let api = try await competitionClient()
    if try await api.transport.pendingRemoval() != nil {
      try await pollRemoval(allowRecovery: true)
      return
    }
    var operation = CompetitionRemovalOperation(
      kind: .delete,
      operationID: UUID().uuidString.lowercased(), accepted: false, deletionReceipt: nil)
    let proof = try await deletionProof(using: api)
    // Server deletion also removes the push binding if this best-effort call fails.
    try? await pushRegistration?.deactivate()
    pushDelegate?.discardPendingRoute()
    try await api.transport.saveRemoval(operation)
    presentation.competitionRemoval = .deleting
    do {
      operation.deletionReceipt = try await api.deletion(
        operationID: operation.operationID, reauthenticationToken: proof)
      operation.accepted = true
      try await api.transport.saveRemoval(operation)
      try await runtime.store().setCompetitionEpoch(nil)
      presentation.invalidateCompetitionPresentation()
      try await pollRemoval(allowRecovery: false)
    } catch {
      presentation.competitionRemoval = .deleteFailed
      throw error
    }
  }

  func watchRemoval() async {
    while !Task.isCancelled, presentation.competitionRemoval == .deleting {
      do {
        try await Task.sleep(for: .seconds(5))
        try Task.checkCancellation()
        try await pollRemoval(allowRecovery: false)
      } catch { return }
    }
  }

  func pollRemoval(allowRecovery: Bool) async throws {
    let api = try await competitionClient()
    guard var operation = try await api.transport.pendingRemoval() else { return }
    presentation.competitionRemoval = .deleting
    do {
      if operation.deletionReceipt == nil
        || operation.deletionReceipt!.polling_token_expires_at_ms <= TrackingRuntime.nowMS
      {
        guard allowRecovery else { throw CompetitionTransportError.unauthorized }
        do {
          operation.deletionReceipt = try await appleSignIn.recoverDeletion(
            transport: api.transport, deviceID: api.deviceID, operationID: operation.operationID)
        } catch let failure as CompetitionTransportError
          where failure.statusCode == 404 && !operation.accepted
        {
          let proof = try await deletionProof(using: api)
          operation.deletionReceipt = try await api.deletion(
            operationID: operation.operationID, reauthenticationToken: proof)
        }
        operation.accepted = true
        try await api.transport.saveRemoval(operation)
      }
      let receipt = operation.deletionReceipt!
      let status = try await api.transport.deletionStatus(
        operationID: operation.operationID, token: receipt.polling_token)
      if status.state == "completed" {
        try await runtime.store().setCompetitionEpoch(nil)
        try pushRegistration?.forgetAfterServerRemoval()
        joinedParticipantID = nil
        presentation.publicTrackingPhone = nil
        pushDelegate?.discardPendingRoute()
        try AppleNameSuggestion.store.remove("apple-name")
        try await api.transport.clearSession()
        try await api.transport.finishRemoval()
        presentation.invalidateCompetitionPresentation()
        setCompetitionAccountExists(false)
        presentation.competitionRemoval = nil
        presentation.competition = .notJoined
        presentation.status = String(
          localized: "profile.deleted", defaultValue: "Competition account deleted")
      } else if status.error_code == "cleanup_requires_attention" {
        presentation.competitionRemoval = .cleanupAttention
      } else if status.state == "failed" {
        presentation.competitionRemoval = .deleteFailed
      }
    } catch let failure as CompetitionTransportError
      where allowRecovery
      && (failure.statusCode == 401 || failure.statusCode == 404)
    {
      presentation.competitionRemoval = .statusUnavailable
    } catch {
      presentation.competitionRemoval = .deleteFailed
      throw error
    }
  }

  func flushEntryDeletions() async {
    guard !flushingEntryDeletions, !accountChanging,
      let participant = presentation.competitionProfile?.id
    else { return }
    flushingEntryDeletions = true
    defer { flushingEntryDeletions = false }
    let identity = accountChangeRevision
    do {
      let store = try await runtime.store()
      let pending = try await store.pendingEntryDeletions(participantID: participant)
      presentation.entryDeletionPending = try await store.hasPendingEntryDeletions()
      deletionRetryAfter = Date.now.addingTimeInterval(30)
      guard !pending.isEmpty else { return }
      let api = try await competitionClient()
      for marker in pending {
        guard identity == accountChangeRevision, !accountChanging,
          presentation.competitionProfile?.id == participant
        else { return }
        let receipt: CompetitionOperation
        do { receipt = try await api.deleteEntry(marker) } catch CompetitionTransportError.service(
          403, "wrong_account", _, _)
        {
          try await store.deferEntryDeletionForDifferentAccount(marker, participantID: participant)
          continue
        }
        guard receipt.state == "completed",
          receipt.operation_id == marker.deletionID.uuidString.lowercased(),
          identity == accountChangeRevision, !accountChanging
        else { throw CompetitionTransportError.invalidResponse }
        try await store.acknowledgeEntryDeletion(marker)
      }
      presentation.entryDeletionPending = try await store.hasPendingEntryDeletions()
      if presentation.competitionJoined { await presentation.requestLeaderboard(using: actions) }
    } catch {
      presentation.entryDeletionPending = true
      deletionRetryAfter = Date.now.addingTimeInterval(30)
    }
  }
}
