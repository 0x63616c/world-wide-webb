import FoldingDomain
import Foundation
import SwiftUI

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
          .tint(FoldingAccent.blue.color)
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
  static let version = 1
  static let fixedClock = "2026-11-02T10:09:00Z"
  let model: FoldingPresentation
  let actions: FoldingActions
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
    guard ["today", "history", "leaderboard", "settings", "tipjar"].contains(scenario),
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
    let now = ISO8601DateFormatter().date(from: Self.fixedClock)!
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
        isCurrentUser: true, percentile: 82),
      LeaderboardEntry(
        id: "sample-rowan", rank: 4, displayName: "Rowan", folds: 82, approvedAvatarURL: nil,
        isCurrentUser: false),
      LeaderboardEntry(
        id: "sample-sam", rank: 5, displayName: "Sam", folds: 70, approvedAvatarURL: nil,
        isCurrentUser: false),
    ]
    let board = LeaderboardPresentation(
      periodTitle: now.formatted(.dateTime.month(.wide).year()), entries: entries,
      currentUser: entries[2], pendingFolds: 0, updatedAt: now, population: 124, percentile: 82)
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
    model.history = history
    model.historyOffset = -1
    model.competition = .loaded(board)
    model.competitionPeriod = .month
    model.competitionProfile = CompetitionProfile(
      id: "sample-mika", nickname: "Mika",
      approvedAvatarURL: nil, nicknamePending: false, avatarState: .none)
    switch scenario {
    case "history": model.selectedTab = .history
    case "leaderboard": model.selectedTab = .leaderboard
    case "settings": model.sheet = .settings
    default: break
    }
    self.model = model
    self.actions = FoldingActions(
      refresh: {}, setup: { _ in throw Failure.readOnly },
      savePreferences: { _ in throw Failure.readOnly }, loadHistory: { _, _ in history },
      loadLeaderboard: { _ in board })
  }
}
