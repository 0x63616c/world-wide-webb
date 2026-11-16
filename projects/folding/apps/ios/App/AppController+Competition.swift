import FoldingDomain
import Foundation

extension AppController {
  func setCompetitionAccountExists(_ exists: Bool, participantID: String? = nil) {
    presentation.competitionAccountExists = exists
    preferencesStore.set(exists, forKey: "folding.competitionAccountExists")
    if let participantID {
      preferencesStore.set(participantID, forKey: "folding.competitionParticipantID")
    }
    if !exists { preferencesStore.removeObject(forKey: "folding.competitionParticipantID") }
  }

  func competitionClient() async throws -> CompetitionAPI {
    guard !accountChanging else { throw CancellationError() }
    let identity = accountChangeRevision
    if let competitionAPI { return competitionAPI }
    guard let originText = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
      let origin = URL(string: originText),
      let environment = Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String
    else { throw CompetitionTransportError.unavailable }
    let store = try await runtime.store()
    let transport = try await CompetitionTransportPool.shared.client(
      origin: origin, deployment: environment,
      deviceID: store.deviceID, bundleID: Bundle.main.bundleIdentifier ?? "app.getfolding.Folding")
    guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
    await FoldingDiagnostics.attach(to: transport, store: store)
    let api = CompetitionAPI(transport: transport, deviceID: store.deviceID)
    competitionAPI = api
    return api
  }

  func selectTrackingPhone() async throws {
    guard joinedParticipantID != nil else {
      try await runtime.useThisPhone()
      return
    }
    let identity = competitionIdentityRevision
    let api = try await competitionClient()
    let store = try await runtime.store()
    let me = try await api.me()
    guard identity == competitionIdentityRevision, me.profile.membership == "joined",
      me.profile.restriction == "none",
      let participant = UUID(uuidString: me.profile.participant_id),
      let enrollment = me.enrollment, let fromEpoch = UUID(uuidString: enrollment.epoch_id)
    else { throw CompetitionTransportError.unavailable }
    let pending = try await store.beginCompetitionTransfer(
      participantID: participant, fromEpochID: fromEpoch,
      replaceChangedEpoch: enrollment.device_id != store.deviceID.uuidString.lowercased())
    // The reset is independent and uses its own durable operation; transfer never invents reset metadata.
    if pending.generation > enrollment.generation {
      try await api.synchronizeTransferReset(pending)
    } else if pending.generation < enrollment.generation {
      // Await the immutable iCloud reset marker instead of constructing a replacement locally.
      throw CompetitionTransportError.unavailable
    }
    let confirmed: CompetitionWireEnrollment
    if enrollment.device_id == store.deviceID.uuidString.lowercased() {
      confirmed = try await api.me().enrollment ?? enrollment
    } else {
      confirmed = try await api.transfer(pending)
    }
    guard identity == competitionIdentityRevision,
      confirmed.device_id == store.deviceID.uuidString.lowercased(),
      confirmed.generation == pending.generation,
      let epoch = UUID(uuidString: confirmed.epoch_id)
    else { throw CompetitionTransportError.invalidResponse }
    try await store.completeCompetitionTransfer(
      pending, epochID: epoch, nowMS: TrackingRuntime.nowMS)
    presentation.publicTrackingPhone = .thisPhone
    await runtime.trackingPhoneChanged()
  }

  private func applyAdminCapability(_ me: CompetitionMe) {
    presentation.isAdmin = me.is_admin == true
    if !presentation.isAdmin { presentation.adminBotIDs = [] }
  }

  private func showPublicTrackingPhone(_ me: CompetitionMe) async throws {
    let identity = accountChangeRevision
    let store = try await runtime.store()
    guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
    let enrollment = me.profile.membership == "joined" ? me.enrollment : nil
    presentation.publicTrackingPhone = enrollment.map {
      $0.device_id == store.deviceID.uuidString.lowercased() ? .thisPhone : .anotherPhone
    }
    if me.profile.restriction == "none", let enrollment,
      enrollment.device_id == store.deviceID.uuidString.lowercased(),
      let epoch = UUID(uuidString: enrollment.epoch_id)
    {
      if let pending = try await store.pendingCompetitionTransfer(),
        pending.participantID.uuidString.lowercased() == me.profile.participant_id,
        pending.generation == enrollment.generation,
        pending.generation == (try await store.currentGeneration())
      {
        // This resumes an explicit prior handover whose response/local commit was interrupted.
        try await store.completeCompetitionTransfer(
          pending, epochID: epoch, nowMS: TrackingRuntime.nowMS)
        await runtime.trackingPhoneChanged()
      } else {
        try await store.setCompetitionEpoch(epoch)
      }
      try await store.configureCompetitionHistory(
        beforeJoinedAtMS: enrollment.history_import_before_ms)
    } else {
      try await store.suspendCompetitionUpload()
    }
  }

  func profilePresentation(_ profile: CompetitionWireProfile) async -> CompetitionProfile {
    let avatar: Data?
    if let id = profile.avatar_id, let api = competitionAPI {
      avatar = try? await api.transport.avatarImage(id)
    } else {
      avatar = nil
    }
    return CompetitionProfile(
      id: profile.participant_id, nickname: profile.nickname,
      approvedAvatarURL: nil,
      avatarState: AvatarState(rawValue: profile.avatar_status) ?? .none,
      approvedAvatarData: avatar)
  }

  func restoreCompetition() async {
    guard !accountChanging else { return }
    let identity = accountChangeRevision
    guard let origin = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
      !origin.isEmpty
    else { return }
    do {
      let client = try await competitionClient()
      if try await client.transport.pendingRemoval() != nil {
        try await pollRemoval(allowRecovery: false)
        return
      }
      if try await client.transport.hasStoredAccount() { setCompetitionAccountExists(true) }
      let me = try await client.me()
      guard identity == accountChangeRevision, !accountChanging else { return }
      applyAdminCapability(me)
      try await showPublicTrackingPhone(me)
      let profile = await profilePresentation(me.profile)
      guard identity == accountChangeRevision, !accountChanging else { return }
      setCompetitionAccountExists(true, participantID: me.profile.participant_id)
      presentation.competitionProfile = profile
      presentation.competitionAuthenticationRequired = false
      competitionRestored = true
      joinedParticipantID =
        me.profile.membership == "joined" && me.profile.restriction == "none"
        ? me.profile.participant_id : nil
      if let remote = me.preferences {
        try notifications.applyResultPreferences(remote)
        if remote.weekly != "off" || remote.monthly != "off" {
          do {
            try await saveRemoteNotificationPreferences(notifications.preferences)
          } catch {
            presentation.error = String(
              localized: "notifications.resultDisableFailed",
              defaultValue: "Couldn’t turn off result alerts. Try again later.")
          }
        }
      }
      await configurePush()
      await flushEntryDeletions()
      guard identity == accountChangeRevision, !accountChanging else { return }
      if me.profile.restriction != "none" {
        presentation.competition = .banned
      } else if me.profile.membership == "joined" {
        await presentation.requestLeaderboard(using: actions)
      } else {
        let name =
          AppleNameSuggestion.name(forParticipant: me.profile.participant_id) ?? me.profile.nickname
        presentation.joinNickname = ["Folder", "Member"].contains(name) ? "" : name
        presentation.competition = .notJoined
      }
    } catch CompetitionTransportError.unauthorized {
      guard identity == accountChangeRevision, !accountChanging else { return }
      joinedParticipantID = nil
      presentation.publicTrackingPhone = nil
      presentation.competitionAuthenticationRequired = presentation.competitionAccountExists
      competitionRestored = true
      await configurePush()
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.competition = .notJoined
    } catch {
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.competition = .failed(presentation.competition.previous)
    }
  }

  func signInToCompetition() async throws {
    let identity = accountChangeRevision
    let api = try await competitionClient()
    let store = try await runtime.store()
    let signedIn = try await appleSignIn.signIn(
      transport: api.transport, deviceID: store.deviceID,
      existingParticipantID: presentation.competitionAuthenticationRequired
        ? (presentation.competitionProfile?.id
          ?? preferencesStore.string(forKey: "folding.competitionParticipantID")) : nil,
      existingAccountOnly: presentation.competitionAuthenticationRequired)
    let profile = signedIn.profile
    let displayedProfile = await profilePresentation(profile)
    guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
    setCompetitionAccountExists(true, participantID: profile.participant_id)
    presentation.competitionProfile = displayedProfile
    presentation.competitionAuthenticationRequired = false
    competitionRestored = true
    joinedParticipantID =
      profile.membership == "joined" && profile.restriction == "none" ? profile.participant_id : nil
    if profile.restriction == "banned" || profile.restriction == "suspended" {
      presentation.competition = .banned
    } else if profile.membership == "joined" {
      let me = try await api.me()
      guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
      applyAdminCapability(me)
      try await showPublicTrackingPhone(me)
      guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
      if let remote = me.preferences {
        try notifications.applyResultPreferences(remote)
        if remote.weekly != "off" || remote.monthly != "off" {
          do {
            try await saveRemoteNotificationPreferences(notifications.preferences)
          } catch {
            presentation.error = String(
              localized: "notifications.resultDisableFailed",
              defaultValue: "Couldn’t turn off result alerts. Try again later.")
          }
        }
      }
      if let enrollment = me.enrollment,
        enrollment.device_id == store.deviceID.uuidString.lowercased(),
        let epoch = UUID(uuidString: enrollment.epoch_id)
      {
        try await store.setCompetitionEpoch(epoch)
        try await store.configureCompetitionHistory(
          beforeJoinedAtMS: enrollment.history_import_before_ms)
      }
      await presentation.requestLeaderboard(using: actions)
    } else {
      presentation.competition = .notJoined
      let suggested = signedIn.suggestedName ?? profile.nickname
      presentation.beginJoin(
        suggestedNickname: ["Folder", "Member"].contains(suggested) ? "" : suggested)
    }
    await configurePush()
  }

  func loadCompetition(_ period: CompetitionPeriod, cursor: String? = nil) async throws
    -> LeaderboardPresentation
  {
    let visibility = competitionIdentityRevision
    let api = try await competitionClient()
    if cursor == nil {
      await runtime.uploadCompetition(using: api.transport)
      await api.transport.invalidateCommunityReads()
    }
    if FoldingDiagnostics.enabled {
      let diagnostics = await runtime.uploadDiagnostics()
      await api.transport.setUploadDiagnostics(worker: diagnostics.worker, queue: diagnostics.queue)
    }
    let board: CompetitionBoard
    do {
      board = try await api.leaderboard(kind: period.rawValue, cursor: cursor)
    } catch let failure as CompetitionTransportError
      where failure.statusCode == 409 && cursor != nil
    {
      throw LeaderboardPageError.snapshotChanged
    }
    guard board.period.kind == period.rawValue else {
      throw CompetitionTransportError.invalidResponse
    }
    let ids = Set((board.page.items + (board.you.map { [$0] } ?? [])).compactMap(\.avatar_id))
    let missing = ids.subtracting(leaderboardAvatars.keys)
    let fetched = await withTaskGroup(of: (String, Data?).self) { group in
      for id in missing { group.addTask { (id, try? await api.transport.avatarImage(id)) } }
      var values: [String: Data] = [:]
      for await (id, data) in group { if let data { values[id] = data } }
      return values
    }
    guard visibility == competitionIdentityRevision else { throw CancellationError() }
    if leaderboardAvatars.count + fetched.count > 500 { leaderboardAvatars.removeAll() }
    leaderboardAvatars.merge(fetched) { _, new in new }
    let avatars = leaderboardAvatars
    func entry(_ row: CompetitionWireRank) -> LeaderboardEntry {
      LeaderboardEntry(
        id: row.participant_id, rank: row.rank,
        displayName: row.blocked == true ? blockedPlayerName(row.participant_id) : row.nickname,
        folds: row.folds, approvedAvatarURL: nil,
        isCurrentUser: row.participant_id == board.you?.participant_id,
        approvedAvatarData: row.avatar_id.flatMap { avatars[$0] },
        featuredBadge: row.blocked == true ? nil : row.featured_badge_id,
        isBlocked: row.blocked == true)
    }
    return LeaderboardPresentation(
      periodTitle: period.title, entries: board.page.items.map(entry),
      currentUser: board.you.map(entry),
      updatedAt: Date(),
      population: board.population,
      nextCursor: board.page.next_cursor, snapshotVersion: board.page.snapshot_version,
      periodID: board.period.id)
  }
}
