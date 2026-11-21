import FoldingDomain
import Foundation
import SwiftUI
import UIKit

import struct FoldingData.SetupProgress
import enum FoldingData.SetupStep
import struct FoldingData.TrackingDiagnosticSnapshot

@MainActor final class AppController {
  let presentation = FoldingPresentation()
  let runtime: TrackingRuntime
  let notifications: NotificationSettingsStore
  var pushRegistration: PushRegistration?
  weak var pushDelegate: FoldingPushAppDelegate?
  var competitionIdentityRevision = UUID()
  var joinedParticipantID: String? {
    didSet {
      if oldValue != joinedParticipantID {
        competitionIdentityRevision = UUID()
        presentation.invalidateMilestones()
        if oldValue != nil { milestoneCache.clear() }
        leaderboardAvatars.removeAll()
      }
      presentation.competitionJoined = joinedParticipantID != nil
    }
  }
  var competitionRestored = false
  /// Approved avatar bytes by avatar ID. A new upload gets a new ID, so entries never go stale;
  /// reusing them keeps period switches from refetching every avatar on the page.
  var leaderboardAvatars: [String: Data] = [:]
  let preferencesStore: UserDefaults
  var competitionAPI: CompetitionAPI?
  let appleSignIn: any CompetitionAccountAuthorizing
  var request = UUID()
  var accountChanging = false
  var accountChangeRevision = UUID()
  private var didLoad = false
  var diagnosticServerRevision = "not_checked"
  var flushingEntryDeletions = false
  var deletionRetryAfter = Date.distantPast
  private let preferencesKey = "folding.preferences.v1"
  /// Counts one app open per return from the background, not per inactive interruption.
  var usageForeground = false
  lazy var milestoneCache = MilestoneCache(defaults: preferencesStore)

  init(
    runtime: TrackingRuntime = .shared, preferencesStore: UserDefaults = .standard,
    initialPreferences: FoldingPreferences = FoldingPreferences(),
    competitionAPI: CompetitionAPI? = nil,
    appleSignIn: any CompetitionAccountAuthorizing = CompetitionSignIn()
  ) {
    self.appleSignIn = appleSignIn
    self.runtime = runtime
    self.competitionAPI = competitionAPI
    self.preferencesStore = preferencesStore
    self.notifications = NotificationSettingsStore(defaults: preferencesStore)
    presentation.competitionAccountExists = preferencesStore.bool(
      forKey: "folding.competitionAccountExists")
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
          preferences.dailyLimit > 0
        else { throw AnalyticsError.invalidRange }
        if preferences.homeTimezone != self.presentation.preferences.homeTimezone {
          try await self.saveRemoteNotificationPreferences(
            self.notifications.preferences,
            homeTimezone: preferences.homeTimezone)
        }
        let previous = self.presentation.preferences
        let data = try JSONEncoder().encode(preferences)
        self.preferencesStore.set(data, forKey: self.preferencesKey)
        self.presentation.preferences = preferences
        if !preferences.shareUsageData {
          await AnalyticsUploader.shared.purge()
        } else if preferences.dailyLimit != previous.dailyLimit {
          self.recordUsage("daily_limit_set")
        }
        await self.runtime.configureDailyLimit()
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
        if saved.dailyLimit, !previous.dailyLimit { self.recordUsage("daily_limit_set") }
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
        self.recordUsage("export", detail: choice == .json ? "json" : "csv")
        return try await self.runtime.prepareExport(
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
      loadAdminParticipant: { id in
        let identity = self.competitionIdentityRevision
        let details = try await self.competitionClient().adminParticipant(id)
        guard identity == self.competitionIdentityRevision else { throw CancellationError() }
        return details
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
      reportParticipant: { id, reason in
        try await self.competitionClient().report(participantID: id, reason: reason.rawValue)
      },
      loadHiddenParticipants: { cursor in try await self.competitionClient().blocks(cursor: cursor)
      },
      setParticipantBlocked: { id, blocked in
        self.presentation.hiddenRequestID = UUID()
        self.presentation.hiddenLoading = false
        try await self.competitionClient().setBlocked(id, blocked: blocked)
        self.competitionIdentityRevision = UUID()
        self.presentation.updateBlockedParticipant(id, blocked: blocked)
        await self.presentation.requestLeaderboard(using: self.actions)
      },
      deleteCompetitionAccount: { try await self.beginAccountDeletion() },
      signInCompetition: {
        self.recordUsage("competition_sign_in", detail: "started")
        try await self.signInToCompetition()
        self.recordUsage("competition_sign_in", detail: "finished")
      },
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
        await self.flushEntryDeletions()
        await self.runtime.synchronizePrivateHistory()
      },
      loadDiagnostics: { try await self.makeDiagnosticReport() },
      clearDiagnostics: { try await self.runtime.clearDiagnostics() },
      checkDiagnostics: { try await self.checkDiagnosticConnection() })
  }

  /// Anonymous usage analytics; nothing is recorded while "Share usage data" is off.
  func recordUsage(_ kind: String, detail: String? = nil) {
    guard presentation.preferences.shareUsageData, !accountChanging else { return }
    Task { await AnalyticsUploader.record(kind, detail: detail) }
  }

  func recordTabUsage(_ tab: FoldingTab) {
    let name =
      switch tab {
      case .today: "today"
      case .history: "history"
      case .leaderboard: "leaderboard"
      case .settings: "settings"
      }
    recordUsage("tab_viewed", detail: name)
    if tab == .leaderboard, presentation.competitionJoined { recordUsage("leaderboard_viewed") }
  }

  func recordSetupUsage(from old: SetupStep?, to new: SetupStep?) {
    guard let old, let new, old != new else { return }
    switch new {
    case .openingInstructions where old == .welcome: recordUsage("setup", detail: "started")
    case .openingPassed: recordUsage("setup", detail: "open_verified")
    case .closingPassed: recordUsage("setup", detail: "close_verified")
    case .complete: recordUsage("setup", detail: "finished")
    case .openingRetry, .closingRetry: recordUsage("error", detail: "setup.timeout")
    default: break
    }
  }

  /// Uploads queued analytics every minute while the app is active.
  func uploadAnalyticsWhileActive() async {
    while !Task.isCancelled {
      await AnalyticsUploader.shared.upload()
      do { try await Task.sleep(for: .seconds(60)) } catch { return }
    }
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
