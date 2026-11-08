import FoldingDomain
import Foundation
import SwiftUI
import UIKit

import struct FoldingData.SetupProgress

@MainActor final class AppController {
  let presentation = FoldingPresentation()
  private let runtime: TrackingRuntime
  private let notifications: NotificationSettingsStore
  private var pushRegistration: PushRegistration?
  private weak var pushDelegate: FoldingPushAppDelegate?
  private var competitionIdentityRevision = UUID()
  private var joinedParticipantID: String? {
    didSet {
      if oldValue != joinedParticipantID {
        competitionIdentityRevision = UUID()
        presentation.invalidateMilestones()
        if oldValue != nil { milestoneCache.clear() }
      }
      presentation.competitionJoined = joinedParticipantID != nil
    }
  }
  private var competitionRestored = false
  private let preferencesStore: UserDefaults
  private var competitionAPI: CompetitionAPI?
  private let appleSignIn = CompetitionSignIn()
  private var request = UUID()
  private var accountChanging = false
  private var accountChangeRevision = UUID()
  private var didLoad = false
  private var flushingEntryDeletions = false
  private var deletionRetryAfter = Date.distantPast
  private let preferencesKey = "folding.preferences.v1"
  private lazy var milestoneCache = MilestoneCache(defaults: preferencesStore)

  init(
    runtime: TrackingRuntime = .shared, preferencesStore: UserDefaults = .standard,
    initialPreferences: FoldingPreferences = FoldingPreferences()
  ) {
    self.runtime = runtime
    self.preferencesStore = preferencesStore
    self.notifications = NotificationSettingsStore(defaults: preferencesStore)
    presentation.preferences = initialPreferences
    if let data = preferencesStore.data(forKey: preferencesKey),
      let preferences = try? JSONDecoder().decode(FoldingPreferences.self, from: data),
      preferences.schemaVersion == 1, TimeZone(identifier: preferences.homeTimezone) != nil
    {
      presentation.preferences = preferences
    } else if let data = try? JSONEncoder().encode(initialPreferences) {
      // Capture the home timezone once; travel must not silently regroup prior history.
      preferencesStore.set(data, forKey: preferencesKey)
    }
  }

  var actions: FoldingActions {
    FoldingActions(
      refresh: {
        try await self.refresh()
        try await self.pollRemoval(allowRecovery: true)
      },
      setup: { action in try await self.runtime.setup(action) },
      savePreferences: { preferences in
        guard preferences.schemaVersion == 1, TimeZone(identifier: preferences.homeTimezone) != nil,
          preferences.dailyLimit > 0, Set(preferences.metrics).count == preferences.metrics.count
        else { throw AnalyticsError.invalidRange }
        if preferences.homeTimezone != self.presentation.preferences.homeTimezone {
          try await self.saveRemoteNotificationPreferences(
            self.notifications.preferences,
            homeTimezone: preferences.homeTimezone)
        }
        let data = try JSONEncoder().encode(preferences)
        self.preferencesStore.set(data, forKey: self.preferencesKey)
        self.presentation.preferences = preferences
        await self.runtime.configureDailyLimit()
        await self.runtime.publishWidgets()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      loadHistory: { period, offset in try await self.history(period, offset: offset) },
      tipJar: { AnyView(TipJarView(store: .shared)) },
      saveNotifications: { requested in
        let previous = self.notifications.preferences
        guard
          self.presentation.competitionJoined
            || (requested.weeklyResult == previous.weeklyResult
              && requested.monthlyResult == previous.monthlyResult
              && requested.badgesEarned == previous.badgesEarned)
        else { throw CompetitionTransportError.unauthorized }
        let saved = try await self.notifications.save(requested) { resolved in
          if previous.weeklyResult != resolved.weeklyResult
            || previous.monthlyResult != resolved.monthlyResult
            || previous.badgesEarned != resolved.badgesEarned
          {
            try await self.saveRemoteNotificationPreferences(resolved)
          }
        }
        self.presentation.notificationPreferences = saved
        await self.configurePush()
        await self.runtime.configureDailyLimit()
        self.presentation.notificationAuthorization = await self.notifications.authorization()
        return saved
      },
      openNotificationSettings: {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return }
        UIApplication.shared.open(url)
      },
      loadSync: { refresh in try await self.runtime.syncStatus(refresh: refresh) },
      useThisPhone: {
        try await self.selectTrackingPhone()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      loadLeaderboard: { period in try await self.loadCompetition(period) },
      loadLeaderboardPage: { period, cursor in
        try await self.loadCompetition(period, cursor: cursor)
      },
      openShortcuts: {
        guard let url = URL(string: "shortcuts://") else { return }
        UIApplication.shared.open(url) { opened in
          if !opened {
            self.presentation.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong.")
          }
        }
      },
      reset: {
        self.presentation.dismissExports()
        try await self.runtime.reset()
        self.milestoneCache.clear()
        self.presentation.invalidateMilestones()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      export: { choice in
        try await self.runtime.prepareExport(
          choice == .json ? .json : .csv,
          homeTimezone: self.presentation.preferences.homeTimezone)
      },
      exportURL: { id in try await self.runtime.exportURL(id) },
      exportFinished: { id in
        do { try await self.runtime.finishExport(id) } catch {
          self.presentation.error = String(
            localized: "error.tryAgain", defaultValue: "Something went wrong.")
        }
      },
      joinCompetition: { nickname in
        let api = try await self.competitionClient()
        let store = try await self.runtime.store()
        let result = try await api.join(nickname: nickname, generation: store.currentGeneration())
        guard let epoch = UUID(uuidString: result.enrollment.epoch_id) else {
          throw CompetitionTransportError.invalidResponse
        }
        try await store.setCompetitionEpoch(epoch)
        try await store.configureCompetitionHistory(
          beforeJoinedAtMS: result.enrollment.history_import_before_ms)
        self.presentation.publicTrackingPhone = .thisPhone
        self.presentation.competitionProfile = await self.profilePresentation(result.profile)
        self.joinedParticipantID = result.profile.participant_id
        self.competitionRestored = true
        await self.configurePush()
        await self.presentation.requestLeaderboard(using: self.actions)
      },
      refreshCompetitionProfile: {
        let revision = self.competitionIdentityRevision
        let profile = try await self.competitionClient().refreshedProfile()
        let value = await self.profilePresentation(profile)
        guard revision == self.competitionIdentityRevision else { throw CancellationError() }
        return value
      },
      loadOwnerMilestones: { try await self.loadOwnerMilestones() },
      loadParticipantProfile: { id in
        let identity = self.competitionIdentityRevision
        let api = try await self.competitionClient()
        let response = try await api.participantProfile(id)
        let avatar =
          if let id = response.profile.avatarID {
            try? await api.transport.avatarImage(id)
          } else { nil as Data? }
        guard identity == self.competitionIdentityRevision, self.joinedParticipantID != nil else {
          throw CancellationError()
        }
        return ParticipantProfileLoad(profile: response, avatarData: avatar)
      },
      acknowledgeMilestones: { participant, request in
        let identity = self.competitionIdentityRevision
        let currentGeneration = try await self.runtime.store().currentGeneration()
        guard participant == self.joinedParticipantID, identity == self.competitionIdentityRevision,
          currentGeneration == request.generation
        else { throw CancellationError() }
        try self.milestoneCache.queue(request, participant: participant)
        try await self.flushMilestoneAcknowledgments(
          participant: participant, generation: request.generation)
      },
      saveNickname: { value in
        let identity = self.competitionIdentityRevision
        let profile = try await self.competitionClient().nickname(value)
        let result = await self.profilePresentation(profile)
        guard identity == self.competitionIdentityRevision else { throw CancellationError() }
        return result
      },
      uploadAvatar: { bytes in
        let revision = self.competitionIdentityRevision
        let api = try await self.competitionClient()
        _ = try await api.uploadAvatar(bytes)
        let profile = try await api.refreshedProfile()
        let value = await self.profilePresentation(profile)
        guard revision == self.competitionIdentityRevision else { throw CancellationError() }
        self.presentation.competitionProfile = value
        return value.avatarState
      },
      removeAvatar: {
        let revision = self.competitionIdentityRevision
        let profile = try await self.competitionClient().removeProfileAvatars()
        let value = await self.profilePresentation(profile)
        guard revision == self.competitionIdentityRevision else { throw CancellationError() }
        self.presentation.competitionProfile = value
      },
      loadResults: { period, cursor in
        let page = try await self.competitionClient().results(kind: period.rawValue, cursor: cursor)
        return CompetitionResultsPage(
          items: try page.items.map(self.resultPresentation),
          nextCursor: page.next_cursor, snapshotVersion: page.snapshot_version)
      },
      loadResultShare: { periodID in
        let api = try await self.competitionClient()
        let share = try await api.share(periodID: periodID)
        let avatar =
          if let id = share.profile.avatar_id { try? await api.transport.avatarImage(id) } else {
            nil as Data?
          }
        return CompetitionShare(
          result: try self.resultPresentation(share.result),
          nickname: share.profile.nickname, approvedAvatarURL: nil, approvedAvatarData: avatar)
      },
      reportParticipant: { id, reason in
        try await self.competitionClient().report(participantID: id, reason: reason.rawValue)
      },
      loadHiddenParticipants: { cursor in try await self.competitionClient().blocks(cursor: cursor)
      },
      setParticipantBlocked: { id, blocked in
        self.presentation.hiddenRequestID = UUID()
        self.presentation.hiddenLoading = false
        try await self.competitionClient().setBlocked(id, blocked: blocked)
      },
      deleteCompetitionAccount: { try await self.beginAccountDeletion() },
      signInCompetition: { try await self.signInToCompetition() },
      loadPatterns: {
        try await self.refresh()
        guard let analytics = self.presentation.analytics else { throw AnalyticsError.invalidRange }
        let events = try await self.runtime.store().retainedEvents()
        return try FoldingActivityPatterns.snapshot(events: events, analytics: analytics)
      },
      deleteIncompleteEntry: { target in
        _ = self.presentation.dismissExports()
        try await self.runtime.cancelExports()
        let store = try await self.runtime.store()
        _ = try await store.deleteIncompleteEntry(
          target,
          participantID: self.presentation.competitionProfile?.id, nowMS: TrackingRuntime.nowMS)
        self.milestoneCache.clear()
        self.presentation.invalidateMilestones()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
        await self.runtime.publishWidgets()
        await self.flushEntryDeletions()
        await self.runtime.synchronizePrivateHistory()
      })
  }

  private func beginAccountDeletion() async throws {
    let api = try await competitionClient()
    if try await api.transport.pendingRemoval() != nil {
      try await pollRemoval(allowRecovery: true)
      return
    }
    var operation = CompetitionRemovalOperation(
      kind: .delete,
      operationID: UUID().uuidString.lowercased(), accepted: false, deletionReceipt: nil)
    let proof = try await appleSignIn.reauthenticate(
      transport: api.transport, deviceID: api.deviceID)
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

  private func pollRemoval(allowRecovery: Bool) async throws {
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
        } catch let failure as CompetitionTransportError where failure.statusCode == 404 {
          let proof = try await appleSignIn.reauthenticate(
            transport: api.transport, deviceID: api.deviceID)
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
        presentation.competitionRemoval = nil
        presentation.competition = .notJoined
      } else if status.state == "failed" {
        presentation.competitionRemoval = .deleteFailed
      }
    } catch {
      presentation.competitionRemoval = .deleteFailed
      throw error
    }
  }

  private func competitionClient() async throws -> CompetitionAPI {
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
    let api = CompetitionAPI(transport: transport, deviceID: store.deviceID)
    competitionAPI = api
    return api
  }

  private func flushMilestoneAcknowledgments(participant: String, generation: ResetGeneration)
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

  private func loadOwnerMilestones() async throws -> MilestoneOwnerLoad {
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

  private func selectTrackingPhone() async throws {
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

  private func profilePresentation(_ profile: CompetitionWireProfile) async -> CompetitionProfile {
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
      let me = try await client.me()
      guard identity == accountChangeRevision, !accountChanging else { return }
      try await showPublicTrackingPhone(me)
      let profile = await profilePresentation(me.profile)
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.competitionProfile = profile
      competitionRestored = true
      joinedParticipantID =
        me.profile.membership == "joined" && me.profile.restriction == "none"
        ? me.profile.participant_id : nil
      if let remote = me.preferences { try notifications.applyResultPreferences(remote) }
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
      competitionRestored = true
      await configurePush()
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.competition = .notJoined
    } catch {
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.competition = .failed(presentation.competition.previous)
    }
  }

  private func signInToCompetition() async throws {
    let identity = accountChangeRevision
    let api = try await competitionClient()
    let store = try await runtime.store()
    let signedIn = try await appleSignIn.signIn(transport: api.transport, deviceID: store.deviceID)
    let profile = signedIn.profile
    let displayedProfile = await profilePresentation(profile)
    guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
    presentation.competitionProfile = displayedProfile
    competitionRestored = true
    joinedParticipantID =
      profile.membership == "joined" && profile.restriction == "none" ? profile.participant_id : nil
    if profile.restriction == "banned" || profile.restriction == "suspended" {
      presentation.competition = .banned
    } else if profile.membership == "joined" {
      let me = try await api.me()
      guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
      try await showPublicTrackingPhone(me)
      guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
      if let remote = me.preferences { try notifications.applyResultPreferences(remote) }
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

  private func resultPresentation(_ result: CompetitionWireResult) throws -> CompetitionResult {
    guard let period = CompetitionPeriod(rawValue: result.kind), period != .all else {
      throw CompetitionTransportError.invalidResponse
    }
    return CompetitionResult(
      id: result.period_id, period: period,
      start: Date(timeIntervalSince1970: Double(result.start_ms) / 1000),
      end: Date(timeIntervalSince1970: Double(result.end_ms) / 1000), version: result.version,
      finalizedAt: Date(timeIntervalSince1970: Double(result.finalized_at_ms) / 1000),
      folds: result.folds, rank: result.rank, population: result.population,
      medal: result.medal.flatMap(CompetitionMedal.init(rawValue:)))
  }

  private func loadCompetition(_ period: CompetitionPeriod, cursor: String? = nil) async throws
    -> LeaderboardPresentation
  {
    let api = try await competitionClient()
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
    let avatars = await withTaskGroup(of: (String, Data?).self) { group in
      for id in ids { group.addTask { (id, try? await api.transport.avatarImage(id)) } }
      var values: [String: Data] = [:]
      for await (id, data) in group { if let data { values[id] = data } }
      return values
    }
    func entry(_ row: CompetitionWireRank) -> LeaderboardEntry {
      LeaderboardEntry(
        id: row.participant_id, rank: row.rank, displayName: row.nickname,
        folds: row.folds, approvedAvatarURL: nil,
        isCurrentUser: row.participant_id == board.you?.participant_id,
        approvedAvatarData: row.avatar_id.flatMap { avatars[$0] },
        featuredBadge: row.featured_badge_id)
    }
    return LeaderboardPresentation(
      periodTitle: period.title, entries: board.page.items.map(entry),
      currentUser: board.you.map(entry),
      pendingFolds: try await runtime.store().pendingCompetitionEventCount(), updatedAt: Date(),
      population: board.population,
      nextCursor: board.page.next_cursor, snapshotVersion: board.page.snapshot_version,
      periodID: board.period.id)
  }

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
    delegate.openResults = { [weak self] id, period in
      guard let self, self.joinedParticipantID != nil, self.presentation.competitionRemoval == nil
      else { return false }
      self.presentation.resultsPeriod = period
      self.presentation.requestedResultID = id
      self.presentation.selectedTab = .leaderboard
      self.presentation.present(.competition(.results))
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

  private func configurePush() async {
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

  private func saveRemoteNotificationPreferences(
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

  func claimReviewRequest() -> Bool {
    guard presentation.selectedTab == .history, presentation.history != nil,
      !presentation.historyLoading, !presentation.historyFailed,
      presentation.sheet == nil, presentation.operation == nil,
      presentation.error == nil, presentation.personalFailure == nil,
      presentation.setup?.step == .complete,
      let completion = presentation.setup?.lastCompletion,
      let analytics = presentation.analytics,
      analytics.days.contains(where: { $0.endMS <= analytics.asOfMS && $0.folds > 0 })
    else { return false }
    return ReviewEligibility(defaults: preferencesStore).claim(
      setupCompletedAtMS: completion.completedAtMS,
      activeDays: analytics.days.filter { $0.folds > 0 }.count,
      nowMS: TrackingRuntime.nowMS)
  }

  func watchJournalChanges() async {
    var last: String?
    while !Task.isCancelled {
      if let token = try? await runtime.store().journalRevisionToken(), token != last {
        last = token
        await refreshVisible()
      }
      if presentation.entryDeletionPending, Date.now >= deletionRetryAfter {
        await flushEntryDeletions()
      }
      do { try await Task.sleep(for: .seconds(1)) } catch { return }
    }
  }

  private func flushEntryDeletions() async {
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

  func watch() async {
    for await _ in await runtime.updates() {
      if Task.isCancelled { return }
      await refreshVisible()
    }
  }

  func cloudAccountChanged() async {
    if !accountChanging, await runtime.hasMatchingLocalIdentity() {
      // CKAccountChanged also reports temporary availability changes. An unchanged
      // device witness preserves offline history; replication still re-verifies CloudKit.
      await runtime.synchronizePrivateHistory()
      return
    }
    let change = UUID()
    accountChangeRevision = change
    accountChanging = true
    request = UUID()
    competitionIdentityRevision = UUID()
    presentation.invalidateCompetitionPresentation()
    presentation.invalidatePersonalPresentation()
    pushDelegate?.discardPendingRoute()
    let previousAPI = competitionAPI
    competitionAPI = nil
    joinedParticipantID = nil
    presentation.publicTrackingPhone = nil
    presentation.competition = .notJoined
    competitionRestored = false
    do {
      try await runtime.suspendForAccountChange(revision: change)
    } catch {
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
      return  // Stay fenced if local partition invalidation failed.
    }
    guard change == accountChangeRevision else { return }
    do { try await pushRegistration?.deactivate() } catch {
      // The account-change fence still proceeds; session revocation remains the server cleanup boundary.
    }
    if let previousAPI { try? await previousAPI.transport.clearSession() }
    guard change == accountChangeRevision else { return }
    do {
      try await runtime.resumeAfterAccountChange(revision: change)
      guard change == accountChangeRevision else { return }
      accountChanging = false
      await refreshVisible()
    } catch {
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
    }
  }

  func maintainCapturedObservations() async { await runtime.maintainCapturedObservations() }

  func maintainCompetitionUploads() async {
    await runtime.maintainCompetitionUploads()
    if presentation.milestonesForeground { await presentation.requestMilestones(using: actions) }
  }

  func synchronizePrivateHistory() async {
    if accountChanging {
      await cloudAccountChanged()
    } else {
      await runtime.synchronizePrivateHistory()
    }
  }

  func refreshVisible() async {
    guard !accountChanging else { return }
    let identity = accountChangeRevision
    presentation.notificationPreferences = notifications.preferences
    let authorization = await notifications.authorization()
    guard identity == accountChangeRevision, !accountChanging else { return }
    presentation.notificationAuthorization = authorization
    await configurePush()
    guard identity == accountChangeRevision, !accountChanging else { return }
    do {
      try await refresh()
      guard identity == accountChangeRevision, !accountChanging else { return }
      // Expired share files are housekeeping. A transient failure must not interrupt setup.
      try? await runtime.cleanupExports()
      await flushEntryDeletions()
      if presentation.history != nil {
        await presentation.requestHistory(using: actions)
      }
      if presentation.milestonesForeground { await presentation.requestMilestones(using: actions) }
    } catch is CancellationError {} catch {
      guard identity == accountChangeRevision, !accountChanging else { return }
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
      presentation.hasLoadedInitialState = true
    }
  }

  func refresh() async throws {
    guard !accountChanging else { throw CancellationError() }
    let token = UUID()
    request = token
    let store = try await runtime.store()
    let now = TrackingRuntime.nowMS
    let timezone = presentation.preferences.homeTimezone
    let range = try PersonalDateRange.trailingDays(7, throughMS: now, homeTimezone: timezone)
    let analytics = try await store.analytics(homeTimezone: timezone, asOfMS: now, range: range)
    let setup = try await store.setupProgress(nowMS: now)
    let lastEvent = try await store.lastObservedAtMS()
    let health = try await store.privateHistoryHealth()
    let sync = try await runtime.syncStatus(refresh: false)
    let deletionPending = try await store.hasPendingEntryDeletions()
    guard request == token, !Task.isCancelled else { return }
    if let previous = presentation.analytics, previous.generation != analytics.generation {
      milestoneCache.clear()
      presentation.invalidateMilestones()
      presentation.dismissExports()
      try await runtime.cancelExports()
      guard request == token, !Task.isCancelled else { return }
    }
    if deletionPending && !presentation.entryDeletionPending {
      milestoneCache.clear()
      presentation.invalidateMilestones()
    }
    presentation.privateHistoryHealth = health
    presentation.syncStatus = sync
    presentation.entryDeletionPending = deletionPending
    presentation.localDeviceID = store.deviceID
    presentation.lastEventAt = lastEvent.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    presentation.analytics = analytics
    presentation.setup = setup
    presentation.personalFailure = nil
    if !didLoad {
      didLoad = true
      presentation.showInitialSetup = setup.step != .complete
    }
    presentation.hasLoadedInitialState = true
  }

  func refreshAtDayBoundary() async {
    guard let endMS = presentation.analytics?.range.endMS else { return }
    do {
      let remaining = max(0, endMS - TrackingRuntime.nowMS)
      try await Task.sleep(for: .milliseconds(remaining))
      guard !Task.isCancelled else { return }
      await refreshVisible()
    } catch is CancellationError {} catch {}
  }

  func observeSetupAttempt() async {
    guard let attempt = presentation.setup?.attemptID, presentation.setup?.step.isWaiting == true
    else { return }
    do {
      let store = try await runtime.store()
      while !Task.isCancelled, presentation.setup?.attemptID == attempt,
        presentation.setup?.step.isWaiting == true
      {
        let progress = try await store.setupProgress(nowMS: TrackingRuntime.nowMS)
        guard !Task.isCancelled, presentation.setup?.attemptID == attempt else { return }
        presentation.setup = progress
        if !progress.step.isWaiting {
          try await refresh()
          return
        }
        try await Task.sleep(for: .milliseconds(500))
      }
    } catch is CancellationError {} catch {
      presentation.error = String(
        localized: "setup.testUnavailable", defaultValue: "Couldn’t check the test. Try again.")
    }
  }

  private func history(_ period: HistoryPeriod, offset: Int) async throws -> HistoryPresentation {
    let domainPeriod: PersonalHistoryPeriod
    switch period {
    case .day: domainPeriod = .day
    case .week: domainPeriod = .week
    case .month: domainPeriod = .month
    case .all: domainPeriod = .all
    }
    let zone = presentation.preferences.homeTimezone
    let store = try await runtime.store()
    let result = try await store.history(
      homeTimezone: zone, asOfMS: TrackingRuntime.nowMS, period: domainPeriod, offset: offset)
    let format = DateFormatter()
    format.timeZone = TimeZone(identifier: zone)
    switch period {
    case .day: format.setLocalizedDateFormatFromTemplate("j")
    case .week: format.dateFormat = "EEE"
    case .month: format.dateFormat = "d"
    case .all: format.dateFormat = "MMM yyyy"
    }
    let range = result.analytics.range
    let start = Date(timeIntervalSince1970: Double(range.startMS) / 1000)
    let end = Date(timeIntervalSince1970: Double(range.endMS) / 1000)
    let interval = DateIntervalFormatter()
    interval.dateStyle = .medium
    interval.timeStyle = .none
    interval.timeZone = TimeZone(identifier: zone)
    return HistoryPresentation(
      title: interval.string(from: start, to: end.addingTimeInterval(-0.001)),
      folds: result.bins.reduce(0) { $0 + $1.folds },
      completeDurationMS: result.analytics.days.reduce(0) { $0 + $1.completeDurationMS },
      bins: result.bins.map { bin in
        let start = Date(timeIntervalSince1970: Double(bin.startMS) / 1000)
        return HistoryBin(
          start: start, end: Date(timeIntervalSince1970: Double(bin.endMS) / 1000),
          label: format.string(from: start), folds: bin.folds)
      },
      sessions: result.analytics.sessions.filter {
        $0.startMS < range.endMS && ($0.endMS ?? Int64.max) > range.startMS
      },
      canGoNext: result.canGoNext, canGoPrevious: result.canGoPrevious)
  }
}
