import FoldingDomain
import Foundation
import SwiftUI
import UIKit

import struct FoldingData.SetupProgress

@MainActor final class AppController {
  let presentation = FoldingPresentation()
  private let runtime: TrackingRuntime
  private let notifications: NotificationSettingsStore
  private let preferencesStore: UserDefaults
  private var competitionAPI: CompetitionAPI?
  private let appleSignIn = CompetitionSignIn()
  private var request = UUID()
  private var didLoad = false
  private let preferencesKey = "folding.preferences.v1"

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
      refresh: { try await self.refresh() },
      setup: { action in try await self.runtime.setup(action) },
      savePreferences: { preferences in
        guard preferences.schemaVersion == 1, TimeZone(identifier: preferences.homeTimezone) != nil,
          preferences.dailyLimit > 0, Set(preferences.metrics).count == preferences.metrics.count
        else { throw AnalyticsError.invalidRange }
        let data = try JSONEncoder().encode(preferences)
        self.preferencesStore.set(data, forKey: self.preferencesKey)
        self.presentation.preferences = preferences
        await self.runtime.configureDailyLimit()
        await self.runtime.publishWidgets()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      loadHistory: { period, offset in try await self.history(period, offset: offset) },
      saveNotifications: { requested in
        let saved = try await self.notifications.save(requested)
        await self.runtime.configureDailyLimit()
        self.presentation.notificationAuthorization = await self.notifications.authorization()
        return saved
      },
      openNotificationSettings: {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return }
        UIApplication.shared.open(url)
      },
      useThisPhone: {
        try await self.runtime.useThisPhone()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      loadLeaderboard: { period in try await self.loadCompetition(period) },
      openShortcuts: {
        guard let url = URL(string: "shortcuts://") else { return }
        UIApplication.shared.open(url) { opened in
          if !opened {
            self.presentation.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
          }
        }
      },
      reset: {
        self.presentation.dismissExports()
        try await self.runtime.reset()
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
            localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
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
        self.presentation.competitionProfile = await self.profilePresentation(result.profile)
        await self.presentation.requestLeaderboard(using: self.actions)
      },
      saveNickname: { value in
        let profile = try await self.competitionClient().nickname(value)
        return await self.profilePresentation(profile)
      },
      uploadAvatar: { bytes in
        let state = try await self.competitionClient().uploadAvatar(bytes)
        return AvatarReviewState(rawValue: state) ?? .pending
      },
      removeAvatar: {
        let api = try await self.competitionClient()
        let me = try await api.me()
        if let id = me.profile.avatar_id { try await api.removeAvatar(id) }
        let refreshed = try await api.me()
        self.presentation.competitionProfile = await self.profilePresentation(refreshed.profile)
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
      setParticipantBlocked: { id, blocked in
        try await self.competitionClient().setBlocked(id, blocked: blocked)
      },
      leaveCompetition: {
        _ = try await self.competitionClient().leave()
        try await self.runtime.store().setCompetitionEpoch(nil)
        self.presentation.invalidateCompetitionPresentation()
        self.presentation.competition = .notJoined
      },
      signInCompetition: { try await self.signInToCompetition() })
  }

  private func competitionClient() async throws -> CompetitionAPI {
    if let competitionAPI { return competitionAPI }
    guard let originText = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
      let origin = URL(string: originText),
      let environment = Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String
    else { throw CompetitionTransportError.unavailable }
    let store = try await runtime.store()
    let transport = try CompetitionTransport(
      origin: origin, deployment: environment,
      deviceID: store.deviceID, bundleID: Bundle.main.bundleIdentifier ?? "app.getfolding.Folding")
    let api = CompetitionAPI(transport: transport, deviceID: store.deviceID)
    competitionAPI = api
    return api
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
      approvedAvatarURL: nil, nicknamePending: profile.nickname_status == "pending",
      avatarState: AvatarReviewState(rawValue: profile.avatar_status) ?? .none,
      approvedAvatarData: avatar)
  }

  func restoreCompetition() async {
    guard let origin = Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String,
      !origin.isEmpty
    else { return }
    do {
      let me = try await competitionClient().me()
      presentation.competitionProfile = await profilePresentation(me.profile)
      if me.profile.restriction != "none" {
        presentation.competition = .banned
      } else if me.profile.membership == "joined" {
        await presentation.requestLeaderboard(using: actions)
      } else {
        presentation.competition = .notJoined
      }
    } catch CompetitionTransportError.unauthorized {
      presentation.competition = .notJoined
    } catch {
      presentation.competition = .failed(presentation.competition.previous)
    }
  }

  private func signInToCompetition() async throws {
    let api = try await competitionClient()
    let store = try await runtime.store()
    let profile = try await appleSignIn.signIn(transport: api.transport, deviceID: store.deviceID)
    presentation.competitionProfile = await profilePresentation(profile)
    if profile.restriction == "banned" || profile.restriction == "suspended" {
      presentation.competition = .banned
    } else if profile.membership == "joined" {
      let me = try await api.me()
      if let enrollment = me.enrollment,
        enrollment.device_id == store.deviceID.uuidString.lowercased(),
        let epoch = UUID(uuidString: enrollment.epoch_id)
      {
        try await store.setCompetitionEpoch(epoch)
      }
      await presentation.requestLeaderboard(using: actions)
    } else {
      presentation.competition = .notJoined
      presentation.beginJoin(suggestedNickname: profile.nickname)
    }
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
      percentile: result.percentile, medal: result.medal.flatMap(CompetitionMedal.init(rawValue:)))
  }

  private func loadCompetition(_ period: CompetitionPeriod) async throws -> LeaderboardPresentation
  {
    let api = try await competitionClient()
    let board = try await api.leaderboard(kind: period.rawValue)
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
        approvedAvatarData: row.avatar_id.flatMap { avatars[$0] }, percentile: row.percentile)
    }
    return LeaderboardPresentation(
      periodTitle: period.title, entries: board.page.items.map(entry),
      currentUser: board.you.map(entry), pendingFolds: 0, updatedAt: Date(),
      population: board.population, percentile: board.you?.percentile)
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

  func watch() async {
    for await _ in await runtime.updates() {
      if Task.isCancelled { return }
      await refreshVisible()
    }
  }

  func cloudAccountChanged() async {
    presentation.invalidateCompetitionPresentation()
    if let competitionAPI { try? await competitionAPI.transport.clearSession() }
    competitionAPI = nil
    presentation.competition = .notJoined
    presentation.dismissExports()
    presentation.analytics = nil
    presentation.history = nil
    presentation.setup = nil
    do {
      try await runtime.accountChanged()
      await refreshVisible()
    } catch {
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
    }
  }

  func synchronizePrivateHistory() async { await runtime.synchronizePrivateHistory() }

  func refreshVisible() async {
    presentation.notificationPreferences = notifications.preferences
    presentation.notificationAuthorization = await notifications.authorization()
    do {
      try await runtime.cleanupExports()
    } catch is CancellationError {
      return
    } catch {
      presentation.error = String(
        localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
    }
    do {
      try await refresh()
      if presentation.history != nil {
        await presentation.requestHistory(using: actions)
      }
    } catch is CancellationError {} catch {
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
    }
  }

  func refresh() async throws {
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
    guard request == token, !Task.isCancelled else { return }
    if let previous = presentation.analytics, previous.generation != analytics.generation {
      presentation.dismissExports()
      try await runtime.cancelExports()
      guard request == token, !Task.isCancelled else { return }
    }
    presentation.privateHistoryHealth = health
    presentation.localDeviceID = store.deviceID
    presentation.lastEventAt = lastEvent.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    presentation.analytics = analytics
    presentation.setup = setup
    presentation.personalFailure = nil
    if !didLoad {
      didLoad = true
      // Presentation-only preference; authoritative setup success remains in the journal.
      if !preferencesStore.bool(forKey: "folding.didPresentInitialSetup") {
        preferencesStore.set(true, forKey: "folding.didPresentInitialSetup")
        presentation.present(.setup)
      }
    }
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
      canGoNext: result.canGoNext)
  }
}
