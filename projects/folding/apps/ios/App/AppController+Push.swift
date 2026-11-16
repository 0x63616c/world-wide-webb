import FoldingDomain
import Foundation

extension AppController {
  func attachPushDelegate(_ delegate: FoldingPushAppDelegate) {
    pushDelegate = delegate
    delegate.registration = pushRegistration
    delegate.localDailyLimitEnabled =
      presentation.notificationPreferences.dailyLimit
      && presentation.notificationAuthorization == .allowed
    delegate.openBadges = { [weak self] participant in
      guard let self, self.joinedParticipantID == participant,
        self.presentation.competitionRemoval == nil
      else { return false }
      self.presentation.selectedTab = .leaderboard
      self.presentation.present(.competition(.milestones))
      return true
    }
    delegate.refreshBadges = { [weak self] in
      guard let self else { return }
      Task { await self.presentation.requestMilestones(using: self.actions, force: true) }
    }
    delegate.openResults = { [weak self] _, _ in
      guard let self, self.joinedParticipantID != nil, self.presentation.competitionRemoval == nil
      else { return false }
      self.presentation.competitionPeriod = .all
      self.presentation.selectedTab = .leaderboard
      return true
    }
  }

  private func ensurePushRegistration() throws -> PushRegistration {
    if let pushRegistration { return pushRegistration }
    let service = try PushRegistration(configuration: PushSigningConfiguration())
    pushRegistration = service
    pushDelegate?.registration = service
    return service
  }

  func configurePush() async {
    let preferences = notifications.preferences
    let authorization = await notifications.authorization()
    presentation.notificationPreferences = preferences
    presentation.notificationAuthorization = authorization
    pushDelegate?.localDailyLimitEnabled = preferences.dailyLimit && authorization == .allowed
    guard competitionRestored else { return }
    do {
      let service = try ensurePushRegistration()
      try await service.configure(
        transport: joinedParticipantID == nil ? nil : competitionAPI?.transport,
        participantID: joinedParticipantID, preferences: preferences, authorization: authorization)
    } catch {
      // APNs registration is retried on foreground; no delivery success is inferred here.
    }
    pushDelegate?.deliverPendingRoute()
  }

  func saveRemoteNotificationPreferences(
    _ value: NotificationPreferences,
    homeTimezone: String? = nil
  ) async throws {
    guard let participantID = joinedParticipantID else {
      guard value.weeklyResult == .off && value.monthlyResult == .off else {
        throw CompetitionTransportError.unavailable
      }
      return
    }
    let identity = competitionIdentityRevision
    let service = try ensurePushRegistration()
    let api = try await competitionClient()
    guard identity == competitionIdentityRevision else { throw CancellationError() }
    try await service.saveResultPreferences(
      value, transport: api.transport, participantID: participantID,
      homeTimezone: homeTimezone ?? presentation.preferences.homeTimezone,
      locale: Bundle.main.preferredLocalizations.first ?? "en")
    guard identity == competitionIdentityRevision else { throw CancellationError() }
  }
}
