import FoldingDomain
import Foundation
import SwiftUI
import UIKit

import struct FoldingData.SetupProgress

#if !targetEnvironment(simulator) || !FOLDING_SCREENSHOTS
  #error("Screenshot fixtures are restricted to the dedicated simulator screenshot target.")
#endif

@main @MainActor struct FoldingScreenshotApp: App {
  private let fixture: ScreenshotFixture
  init() {
    do { fixture = try ScreenshotFixture(arguments: ProcessInfo.processInfo.arguments) } catch {
      fatalError("Invalid screenshot fixture configuration: \(error)")
    }
  }
  var body: some Scene {
    WindowGroup {
      Group {
        if fixture.scenario == "tipjar" {
          NavigationStack {
            TipJarContent(
              rows: fixture.tipRows, loading: false, purchasing: nil, message: nil,
              retry: { fatalError("Reviewer capture is read-only") },
              purchase: { _ in fatalError("Reviewer capture is read-only") })
          }
          .allowsHitTesting(false)
          .preferredColorScheme(.light)
          .tint(FoldingTint.color)
        } else if fixture.scenario == "notifications" {
          NavigationStack {
            NotificationSettingsScreen(model: fixture.model, actions: fixture.actions)
          }
          .fontDesign(.rounded)
          .preferredColorScheme(fixture.model.preferences.appearance.scheme)
          .tint(FoldingTint.color)
        } else {
          FoldingRootView(model: fixture.model, actions: fixture.actions)
        }
      }
      .environment(\.locale, Locale(identifier: fixture.locale))
      .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
      .accessibilityIdentifier("folding.screenshot.ready")
    }
  }
}

/// Compiled only into FoldingScreenshots. No live composition dependency is linked into this target.
@MainActor struct ScreenshotFixture {
  static let version = 2
  static let fixedClock = "2026-11-02T10:09:00Z"
  let model: FoldingPresentation
  var actions: FoldingActions
  let locale: String
  let scenario: String
  let tipRows: [TipJarRow]
  enum Failure: Error { case invalidArguments, readOnly }

  init(arguments: [String]) throws {
    func value(_ flag: String, default fallback: String) -> String {
      guard let index = arguments.lastIndex(of: flag), index + 1 < arguments.count else {
        return fallback
      }
      return arguments[index + 1]
    }
    scenario = value("--folding-screenshot-scenario", default: "today")
    locale = value("--folding-screenshot-locale", default: "en")
    let appearance = value("--folding-screenshot-appearance", default: "light")
    guard
      [
        "today", "today-running", "today-live", "history", "history-month", "history-long",
        "patterns", "milestones", "notifications", "leaderboard", "settings", "setup", "join",
        "tipjar",
      ]
      .contains(scenario),
      ["en", "de", "fr", "es", "es-419", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"].contains(
        locale) || (scenario == "tipjar" && locale == "en-US"),
      ["light", "dark"].contains(appearance)
    else { throw Failure.invalidArguments }
    if scenario == "tipjar" {
      guard ["en", "en-US"].contains(locale), appearance == "light" else {
        throw Failure.invalidArguments
      }
      tipRows = try TipReviewFixture.load()
    } else {
      tipRows = []
    }
    // The diagnostic live-timer scene uses the real clock; release/storefront fixtures remain fixed.
    let now =
      scenario == "today-live" ? Date.now : ISO8601DateFormatter().date(from: Self.fixedClock)!
    let nowMS = Int64(now.timeIntervalSince1970 * 1000)
    let device = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    var events: [TrackingEvent] = []
    var sequence: Int64 = 0
    let todayStart = nowMS - (10 * 60 + 9) * 60_000
    for day in 0..<28 {
      let start = todayStart - Int64(27 - day) * 86_400_000 + 6 * 3_600_000
      let cycles = [24, 31, 19, 38, 27, 34, 29][day % 7]
      for cycle in 0..<cycles {
        for (offset, transition) in [Transition.open, .close].enumerated() {
          sequence += 1
          events.append(
            TrackingEvent(
              schemaVersion: 1,
              eventID: UUID(
                uuidString: String(format: "22222222-2222-2222-2222-%012lld", sequence))!,
              deviceID: device, sequence: sequence, generation: .initial,
              observedAtMS: start + Int64(cycle) * 360_000 + Int64(offset) * 180_000,
              timezoneID: "GMT", transition: transition, isTest: false, competitionEpochID: nil))
        }
      }
    }
    if scenario == "today-running" || scenario == "today-live" {
      sequence += 1
      events.append(
        TrackingEvent(
          schemaVersion: 1, eventID: UUID(uuidString: "77777777-7777-7777-7777-777777777777")!,
          deviceID: device,
          sequence: sequence, generation: .initial, observedAtMS: nowMS - 30 * 60_000,
          timezoneID: "GMT", transition: .open, isTest: false, competitionEpochID: nil))
    }
    let range = try PersonalDateRange.trailingDays(7, throughMS: nowMS, homeTimezone: "GMT")
    let analytics = try PersonalAnalytics.snapshot(
      events: events, generation: .initial,
      homeTimezone: "GMT", asOfMS: nowMS, range: range)
    let historyRange = PersonalDateRange(startMS: todayStart - 7 * 86_400_000, endMS: todayStart)
    let historySnapshot = try PersonalAnalytics.snapshot(
      events: events, generation: .initial,
      homeTimezone: "GMT", asOfMS: nowMS, range: historyRange)
    let history = HistoryPresentation(
      title: Date(timeIntervalSince1970: Double(historyRange.startMS) / 1000).formatted(
        .dateTime.month(.abbreviated).day()),
      folds: historySnapshot.days.reduce(0) { $0 + $1.folds },
      completeDurationMS: historySnapshot.days.reduce(0) { $0 + $1.completeDurationMS },
      bins: historySnapshot.days.map { day in
        let start = Date(timeIntervalSince1970: Double(day.startMS) / 1000)
        return HistoryBin(
          start: start, end: Date(timeIntervalSince1970: Double(day.endMS) / 1000),
          label: start.formatted(.dateTime.weekday(.abbreviated)), folds: day.folds)
      }, sessions: Array(historySnapshot.sessions.filter { $0.startMS < todayStart }.suffix(6)),
      canGoNext: true)
    let entries = [
      LeaderboardEntry(
        id: "sample-ari", rank: 1, displayName: "Ari", folds: 184, approvedAvatarURL: nil,
        isCurrentUser: false),
      LeaderboardEntry(
        id: "sample-kai", rank: 1, displayName: "Kai", folds: 184, approvedAvatarURL: nil,
        isCurrentUser: false),
      LeaderboardEntry(
        id: "sample-mika", rank: 3, displayName: "Mika", folds: 96, approvedAvatarURL: nil,
        isCurrentUser: true),
      LeaderboardEntry(
        id: "sample-rowan", rank: 4, displayName: "Rowan", folds: 82, approvedAvatarURL: nil,
        isCurrentUser: false),
      LeaderboardEntry(
        id: "sample-sam", rank: 5, displayName: "Sam", folds: 70, approvedAvatarURL: nil,
        isCurrentUser: false),
    ]
    let board = LeaderboardPresentation(
      periodTitle: now.formatted(.dateTime.month(.wide).year()), entries: entries,
      currentUser: entries[2], pendingFolds: 0, updatedAt: now, population: 124)
    let setupJSON = """
      {"schemaVersion":1,"flowID":"33333333-3333-3333-3333-333333333333",
       "deviceID":"11111111-1111-1111-1111-111111111111",
       "generation":{"revision":0,"reset_id":"00000000-0000-0000-0000-000000000000"},
       "step":"complete","openingEventID":"44444444-4444-4444-4444-444444444444",
       "closingEventID":"55555555-5555-5555-5555-555555555555"}
      """
    let setup = try JSONDecoder().decode(SetupProgress.self, from: Data(setupJSON.utf8))
    let model = FoldingPresentation()
    model.hasLoadedInitialState = true
    model.analytics = analytics
    model.setup = setup
    model.localDeviceID = device
    model.lastEventAt = Date(timeIntervalSince1970: Double(events.last!.observedAtMS) / 1000)
    model.preferences.homeTimezone = "GMT"
    model.preferences.appearance = appearance == "dark" ? .dark : .light
    let displayedPeriod: HistoryPeriod = scenario == "history-month" ? .month : .week
    let displayedOffset = scenario == "history-month" ? 0 : -1
    model.history = try Self.history(
      events: events, at: nowMS, period: displayedPeriod, offset: displayedOffset)
    model.historyPeriod = displayedPeriod
    model.historyOffset = displayedOffset
    model.competitionJoined = true
    model.competition = .loaded(board)
    let owner = OwnerMilestones(
      generation: .initial, revision: 1,
      progress: MilestoneProgress(
        catalogVersion: 1, folds: 842, daysUsed: 28,
        next: [
          NextMilestone(track: .folds, badgeID: .folds1000, current: 842, target: 1000),
          NextMilestone(track: .days, badgeID: .days30, current: 28, target: 30),
        ],
        earned: [.folds1, .folds100, .days7]),
      grants: [MilestoneBadge.folds1, .folds100, .days7].enumerated().map {
        EarnedMilestone(
          badgeID: $0.element, earnedAtMS: nowMS - Int64(25 - $0.offset * 7) * 86_400_000,
          acknowledged: true)
      }, featuredBadgeID: .folds100)
    try owner.validate()
    model.ownerMilestones = owner
    model.competitionPeriod = .month
    model.competitionProfile = CompetitionProfile(
      id: "sample-mika", nickname: "Mika",
      approvedAvatarURL: nil, avatarState: .none)
    switch scenario {
    case "history", "history-long", "history-month": model.selectedTab = .history
    case "patterns": model.sheet = .patterns
    case "milestones": model.sheet = .competition(.milestones)
    case "notifications":
      model.notificationAuthorization = .allowed
      model.notificationPreferences.dailyLimit = true
    case "leaderboard": model.selectedTab = .leaderboard
    case "settings": model.selectedTab = .settings
    case "join":
      model.joinNickname = "Mika"
      model.sheet = .competition(.join)
    case "setup":
      model.setup = try JSONDecoder().decode(
        SetupProgress.self,
        from: Data(
          setupJSON.replacingOccurrences(
            of: "\"step\":\"complete\"", with: "\"step\":\"openingReady\""
          ).utf8))
      model.showInitialSetup = true
    default: break
    }
    let fixtureEvents = events
    self.model = model
    self.actions = FoldingActions(
      refresh: {}, setup: { _ in throw Failure.readOnly },
      // Interaction fixtures only mutate this in-memory model, never app/provider data.
      savePreferences: { proposed in model.preferences = proposed },
      loadHistory: { period, offset in
        try Self.history(events: fixtureEvents, at: nowMS, period: period, offset: offset)
      },
      saveNotifications: { proposed in
        model.notificationPreferences = proposed
        return proposed
      },
      loadLeaderboard: { _ in board }, openShortcuts: {},
      joinCompetition: { _ in throw Failure.readOnly },
      uploadAvatar: { _ in throw Failure.readOnly },
      loadPatterns: {
        try FoldingActivityPatterns.snapshot(events: fixtureEvents, analytics: analytics)
      }, deleteIncompleteEntry: { _ in throw Failure.readOnly })
    self.actions.loadOwnerMilestones = { MilestoneOwnerLoad(snapshot: owner, confirmed: true) }
    self.actions.featureMilestone = { _, _, _ in throw Failure.readOnly }
    self.actions.acknowledgeMilestones = { _, _ in throw Failure.readOnly }
  }
  private static func history(
    events: [TrackingEvent], at nowMS: Int64, period: HistoryPeriod, offset: Int
  ) throws -> HistoryPresentation {
    let result = try PersonalHistory.snapshot(
      events: events, interruptions: [], generation: .initial,
      homeTimezone: "GMT", asOfMS: nowMS, period: PersonalHistoryPeriod(rawValue: period.rawValue)!,
      offset: offset)
    let format = DateFormatter()
    format.timeZone = TimeZone(secondsFromGMT: 0)
    format.locale = Locale.current
    switch period {
    case .day: format.dateFormat = "j"
    case .week: format.dateFormat = "EEE"
    case .month: format.dateFormat = "d"
    case .all: format.dateFormat = "MMM yyyy"
    }
    let range = result.analytics.range
    let interval = DateIntervalFormatter()
    interval.dateStyle = .medium
    interval.timeStyle = .none
    interval.timeZone = TimeZone(secondsFromGMT: 0)
    let start = Date(timeIntervalSince1970: Double(range.startMS) / 1000)
    let end = Date(timeIntervalSince1970: Double(range.endMS) / 1000)
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

// Validation-only model dependency. The simulator fixture target links no transport or live API client.
enum CompetitionTransportError: Error { case invalidResponse }
