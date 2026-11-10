import FoldingDomain
import Foundation
import XCTest

@testable import Folding

@MainActor final class PresentationTests: XCTestCase {
  func testBlockedContractDecodesOldAndNewResponsesWithoutChangingRanks() throws {
    let old = Data(
      #"{"participant_id":"id","nickname":"Name","avatar_id":null,"folds":42,"rank":2,"medal":"silver"}"#
        .utf8)
    let legacy = try JSONDecoder().decode(CompetitionWireRank.self, from: old)
    XCTAssertNil(legacy.blocked)
    let new = Data(
      #"{"participant_id":"id","nickname":"Blocked player","avatar_id":null,"folds":42,"rank":2,"medal":"silver","blocked":true,"featured_badge_id":null}"#
        .utf8)
    let masked = try JSONDecoder().decode(CompetitionWireRank.self, from: new)
    XCTAssertEqual(masked.rank, legacy.rank)
    XCTAssertEqual(masked.folds, legacy.folds)
    XCTAssertEqual(masked.blocked, true)
    // Exact shipped DTO shape: new responses retain all required legacy fields.
    // swift-format-ignore: AlwaysUseLowerCamelCase
    struct ShippedRank: Decodable {
      let participant_id: String
      let nickname: String
      let avatar_id: String?
      let folds: Int
      let rank: Int
      let medal: String?
    }
    XCTAssertEqual(try JSONDecoder().decode(ShippedRank.self, from: new).nickname, "Blocked player")
  }

  func testBlockingClearsRetainedIdentityAndInvalidatesProfileContext() {
    let model = FoldingPresentation()
    let id = UUID().uuidString.lowercased()
    let row = LeaderboardEntry(
      id: id, rank: 1, displayName: "Name", folds: 50, approvedAvatarURL: nil, isCurrentUser: false,
      approvedAvatarData: Data([1]), featuredBadge: nil)
    model.competition = .loaded(
      LeaderboardPresentation(
        periodTitle: "All", entries: [row], currentUser: nil, updatedAt: Date(), population: 20))
    let context = model.milestonesContext
    model.updateBlockedParticipant(id, blocked: true)
    XCTAssertNotEqual(context, model.milestonesContext)
    XCTAssertTrue(model.hiddenParticipantIDs.contains(id))
    let masked = model.competition.previous!.entries[0]
    XCTAssertEqual(masked.rank, 1)
    XCTAssertEqual(masked.folds, 50)
    XCTAssertEqual(model.competition.previous?.population, 20)
    XCTAssertTrue(masked.isBlocked)
    XCTAssertEqual(masked.displayName, blockedPlayerName(id))
    XCTAssertNil(masked.approvedAvatarData)
    XCTAssertNil(masked.featuredBadge)
  }

  func testAppleNameSurvivesRepeatAuthorizationAndDoesNotCrossAccounts() throws {
    let store = CompetitionCredentialStore(service: "folding.name.test.\(UUID())")
    defer { try? store.remove("apple-name") }
    var name = PersonNameComponents()
    name.givenName = "Ari"
    name.familyName = "Webb"
    XCTAssertEqual(try AppleNameSuggestion.resolve(name, userID: "first", store: store), "Ari Webb")
    XCTAssertEqual(try AppleNameSuggestion.resolve(nil, userID: "first", store: store), "Ari Webb")
    XCTAssertNil(try AppleNameSuggestion.resolve(nil, userID: "second", store: store))
    XCTAssertNil(try AppleNameSuggestion.resolve(nil, userID: "first", store: store))
  }

  func testBadgePushRouteRequiresKnownAwardsAndOwnerIdentity() {
    let owner = UUID().uuidString.lowercased()
    let payload: [AnyHashable: Any] = [
      "folding": [
        "kind": "badges_earned", "participant_id": owner, "badge_ids": ["folds_1", "days_7"],
      ]
    ]
    let route = PushNotificationRoute.parse(payload)
    XCTAssertEqual(route?.participantID, owner)
    XCTAssertEqual(route?.isBadge, true)
    for ids in [[], ["unknown"], ["folds_1", "folds_1"]] {
      XCTAssertNil(
        PushNotificationRoute.parse([
          "folding": ["kind": "badges_earned", "participant_id": owner, "badge_ids": ids]
        ]))
    }
    XCTAssertNil(
      PushNotificationRoute.parse([
        "folding": ["kind": "badges_earned", "participant_id": "other", "badge_ids": ["folds_1"]]
      ]))
  }

  func testAddingBadgeNotificationPreferencePreservesOldChoices() throws {
    let legacy = Data(#"{"dailyLimit":true,"weeklyResult":"podium","monthlyResult":"all"}"#.utf8)
    var preferences = try JSONDecoder().decode(NotificationPreferences.self, from: legacy)
    XCTAssertTrue(preferences.dailyLimit)
    XCTAssertEqual(preferences.weeklyResult, .podium)
    XCTAssertEqual(preferences.monthlyResult, .all)
    XCTAssertFalse(preferences.badgesEarned)
    preferences.badgesEarned = true
    XCTAssertEqual(
      try JSONDecoder().decode(
        NotificationPreferences.self, from: JSONEncoder().encode(preferences)), preferences)
  }

  func testSummaryCardsPairInWideViewsAndStackForAccessibility() {
    let metrics: [SummaryMetric] = [
      .folds, .timeUnfolded, .trend, .opens, .closes, .cycles, .lifetimeFolds,
    ]
    let wide = SummaryCardLayout.rows(metrics, width: 700, accessibilitySize: false)
    XCTAssertEqual(
      wide, [[.folds, .timeUnfolded], [.trend, .opens], [.closes, .cycles], [.lifetimeFolds]])
    XCTAssertEqual(wide.flatMap { $0 }, metrics)
    XCTAssertEqual(
      SummaryCardLayout.rows(metrics, width: 390, accessibilitySize: false),
      [[.folds], [.timeUnfolded], [.trend], [.opens, .closes], [.cycles, .lifetimeFolds]])
    XCTAssertEqual(
      SummaryCardLayout.rows(metrics, width: 700, accessibilitySize: true), metrics.map { [$0] })
    XCTAssertFalse(SummaryCardLayout.usesWideRows(width: 599, accessibilitySize: false))
    XCTAssertTrue(SummaryCardLayout.usesWideRows(width: 600, accessibilitySize: false))
  }

  func testElapsedTimeUsesCompactDaysAndOmitsZeroUnits() {
    let locale = Locale(identifier: "en_US")
    XCTAssertEqual(foldingElapsedDuration(14_582_000, locale: locale), "4h 3m 2s")
    XCTAssertEqual(foldingElapsedDuration(270_063_000, locale: locale), "3d 3h 1m 3s")
    XCTAssertEqual(foldingElapsedDuration(86_400_000, locale: locale), "1d")
    XCTAssertEqual(foldingElapsedDuration(-1, locale: locale), "0s")
  }

  func testPhoneNamesAreOptionalAndRemainBoundToDeviceIdentity() throws {
    let first = UUID()
    let second = UUID()
    var preferences = FoldingPreferences()
    var legacy = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(preferences)) as? [String: Any])
    legacy.removeValue(forKey: "phoneNames")
    let old = try JSONDecoder().decode(
      FoldingPreferences.self, from: JSONSerialization.data(withJSONObject: legacy))
    XCTAssertTrue(old.phoneNames.isEmpty)
    preferences.phoneNames[first.uuidString.lowercased()] = "Daily phone"
    let saved = try JSONDecoder().decode(
      FoldingPreferences.self, from: JSONEncoder().encode(preferences))
    let model = FoldingPresentation()
    model.preferences = saved
    XCTAssertEqual(model.phoneName(for: first, fallback: "This iPhone"), "Daily phone")
    XCTAssertEqual(model.phoneName(for: second, fallback: "Another iPhone"), "Another iPhone")
    XCTAssertEqual(model.phoneName(for: nil, fallback: "Not selected"), "Not selected")
  }

  func testLegacyAccentIsIgnoredWithoutLosingPreferences() throws {
    var preferences = FoldingPreferences()
    preferences.appearance = .dark
    preferences.dailyLimit = 250
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(preferences)) as? [String: Any])
    json["accent"] = "purple"
    let decoded = try JSONDecoder().decode(
      FoldingPreferences.self, from: JSONSerialization.data(withJSONObject: json))
    XCTAssertEqual(decoded, preferences)
    let encoded = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(decoded)) as? [String: Any])
    XCTAssertNil(encoded["accent"])
  }

  func testWidgetLinkPreservesSetupAndRejectsUntrustedDestinations() {
    let model = FoldingPresentation()
    model.present(.setup)
    model.openWidgetURL(URL(string: "folding://history")!)
    XCTAssertEqual(model.selectedTab, .history)
    XCTAssertEqual(model.sheet, .setup)
    for value in [
      "https://history", "folding://user@today", "folding://today:443", "folding://today/erase",
      "folding://today?reset=true",
    ] {
      model.openWidgetURL(URL(string: value)!)
      XCTAssertEqual(model.selectedTab, .history)
    }
    model.openWidgetURL(URL(string: "folding://today")!)
    XCTAssertEqual(model.selectedTab, .today)
  }

  func testNotificationLocalesFallbackWithoutBlockingPreferences() {
    XCTAssertEqual(PushRegistration.supportedLocale("it-IT"), "en")
    XCTAssertEqual(PushRegistration.supportedLocale("ja-JP"), "ja")
    XCTAssertEqual(PushRegistration.supportedLocale("pt-BR"), "pt-BR")
  }

  func testAccountFenceDiscardsPendingHistoryResponse() async throws {
    let model = FoldingPresentation()
    var pending: CheckedContinuation<HistoryPresentation, Error>?
    var actions = actions()
    actions.loadHistory = { _, _ in
      try await withCheckedThrowingContinuation { pending = $0 }
    }
    let task = Task { await model.requestHistory(using: actions) }
    try await waitFor { pending != nil }
    model.invalidatePersonalPresentation()
    pending!.resume(returning: history("Old account"))
    await task.value
    XCTAssertNil(model.history)
    XCTAssertFalse(model.historyLoading)
  }

  private enum Failure: Error { case unavailable }

  func testOlderHistorySuccessDoesNotReplaceNewPeriod() async throws {
    let model = FoldingPresentation()
    var pending: [Int: CheckedContinuation<HistoryPresentation, Error>] = [:]
    var actions = actions()
    actions.loadHistory = { _, offset in
      try await withCheckedThrowingContinuation { pending[offset] = $0 }
    }
    let first = Task { await model.requestHistory(using: actions) }
    try await waitFor { pending[0] != nil }
    model.historyOffset = -1
    let second = Task { await model.requestHistory(using: actions) }
    try await waitFor { pending[-1] != nil }
    pending[-1]!.resume(returning: history("New period"))
    await second.value
    pending[0]!.resume(returning: history("Old period"))
    await first.value
    XCTAssertEqual(model.history?.title, "New period")
    XCTAssertFalse(model.historyLoading)
    XCTAssertFalse(model.historyFailed)
  }

  func testOlderHistoryFailureDoesNotClearCurrentLoading() async throws {
    let model = FoldingPresentation()
    var pending: [Int: CheckedContinuation<HistoryPresentation, Error>] = [:]
    var actions = actions()
    actions.loadHistory = { _, offset in
      try await withCheckedThrowingContinuation { pending[offset] = $0 }
    }
    let first = Task { await model.requestHistory(using: actions) }
    try await waitFor { pending[0] != nil }
    model.historyOffset = -1
    let second = Task { await model.requestHistory(using: actions) }
    try await waitFor { pending[-1] != nil }
    pending[0]!.resume(throwing: Failure.unavailable)
    await first.value
    XCTAssertTrue(model.historyLoading)
    XCTAssertFalse(model.historyFailed)
    pending[-1]!.resume(returning: history("New period"))
    await second.value
    XCTAssertEqual(model.history?.title, "New period")
  }

  func testLeaderboardKeepsCurrentContentWhenChangingPeriod() async throws {
    let model = FoldingPresentation()
    model.competition = .loaded(leaderboard("Visible week"))
    model.competitionPeriod = .month
    var pending: CheckedContinuation<LeaderboardPresentation, Error>?
    var actions = actions()
    actions.loadLeaderboard = { _ in try await withCheckedThrowingContinuation { pending = $0 } }
    let task = Task { await model.requestLeaderboard(using: actions) }
    try await waitFor { pending != nil }
    XCTAssertEqual(model.competition.previous?.periodTitle, "Visible week")
    pending!.resume(returning: leaderboard("New month"))
    await task.value
    XCTAssertEqual(model.competition.previous?.periodTitle, "New month")
  }

  func testAllTimeResultsUseLiveAllTimeLeaderboard() async {
    let model = FoldingPresentation()
    model.resultsPeriod = .all
    var actions = actions()
    var requested: CompetitionPeriod?
    actions.loadLeaderboard = { period in
      requested = period
      return self.leaderboard("All Time")
    }
    await model.requestResults(using: actions)
    XCTAssertEqual(requested, .all)
    XCTAssertEqual(model.allTimeResult?.periodTitle, "All Time")
    XCTAssertFalse(model.resultsFailed)
    model.invalidateCompetitionPresentation()
    XCTAssertNil(model.allTimeResult)
  }

  func testOlderLeaderboardSuccessDoesNotReplaceNewPeriod() async throws {
    let model = FoldingPresentation()
    var pending: [CompetitionPeriod: CheckedContinuation<LeaderboardPresentation, Error>] = [:]
    var actions = actions()
    actions.loadLeaderboard = { period in
      try await withCheckedThrowingContinuation { pending[period] = $0 }
    }
    let first = Task { await model.requestLeaderboard(using: actions) }
    try await waitFor { pending[.week] != nil }
    model.competitionPeriod = .month
    let second = Task { await model.requestLeaderboard(using: actions) }
    try await waitFor { pending[.month] != nil }
    pending[.month]!.resume(returning: leaderboard("Month"))
    await second.value
    pending[.week]!.resume(returning: leaderboard("Week"))
    await first.value
    guard case .loaded(let result) = model.competition else {
      return XCTFail("Current leaderboard did not finish loading")
    }
    XCTAssertEqual(result.periodTitle, "Month")
  }

  func testOneModalIsDismissedBeforeNextPresentation() {
    let model = FoldingPresentation()
    model.present(.settings)
    model.present(.setup)
    XCTAssertNil(model.sheet)
    model.didDismissSheet()
    XCTAssertEqual(model.sheet, .setup)
  }

  func testRetiredTravelMigrationAndCardOrderPersistence() throws {
    var preferences = FoldingPreferences()
    preferences.homeTimezone = "UTC"
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(preferences)) as? [String: Any])
    json["metrics"] = ["equivalentTravel", "timeUnfolded", "trend"]
    json["travelUnit"] = "feet"
    var decoded = try JSONDecoder().decode(
      FoldingPreferences.self, from: JSONSerialization.data(withJSONObject: json))
    XCTAssertEqual(decoded.metrics, [.timeUnfolded, .trend])
    XCTAssertEqual(decoded.homeTimezone, "UTC")
    decoded.moveCard(.trend, to: .folds)
    XCTAssertEqual(decoded.orderedCards, [.trend, .folds, .timeUnfolded])
    let reopened = try JSONDecoder().decode(
      FoldingPreferences.self, from: JSONEncoder().encode(decoded))
    XCTAssertEqual(reopened.orderedCards, decoded.orderedCards)
  }

  func testMainDurationIncludesRunningTimeAndStopsAfterClose() throws {
    let snapshot = try runningSnapshot(open: "2026-03-08T09:00:00Z", at: "2026-03-08T09:00:00Z")
    let day = try XCTUnwrap(snapshot.days.last)
    let running = RunningDurationPresentation(snapshot: snapshot, day: day)
    XCTAssertEqual(running.totalDurationMS(at: date("2026-03-08T09:00:05Z")), 5_000)
    let closed = try runningSnapshot(
      open: "2026-03-08T09:00:00Z", at: "2026-03-08T09:00:10Z", closed: true)
    let finished = RunningDurationPresentation(
      snapshot: closed, day: try XCTUnwrap(closed.days.last))
    XCTAssertEqual(finished.totalDurationMS(at: date("2026-03-08T09:00:20Z")), 10_000)
  }

  func testRunningDurationAdvancesWithoutMutatingSnapshot() throws {
    let snapshot = try runningSnapshot(open: "2026-03-08T09:00:00Z", at: "2026-03-08T09:00:00Z")
    let day = try XCTUnwrap(snapshot.days.last)
    let running = RunningDurationPresentation(snapshot: snapshot, day: day)
    XCTAssertTrue(running.isRunning, "A zero-second session must show its live timer")
    XCTAssertEqual(running.durationMS(at: date("2026-03-08T09:00:05Z")), 5_000)
    XCTAssertEqual(day.runningDurationMS, 0, "Rendering must not change the immutable snapshot")
  }

  func testRunningDurationClampsToDSTHomeDayAndBackwardsClock() throws {
    let snapshot = try runningSnapshot(open: "2026-03-08T07:00:00Z", at: "2026-03-08T09:00:00Z")
    let day = try XCTUnwrap(snapshot.days.last)
    let running = RunningDurationPresentation(snapshot: snapshot, day: day)
    XCTAssertEqual(running.durationMS(at: date("2026-03-08T08:00:00Z")), 3_600_000)
    XCTAssertEqual(running.durationMS(at: date("2026-03-10T12:00:00Z")), 23 * 3_600_000)
    XCTAssertEqual(day.endMS - day.startMS, 23 * 3_600_000)
  }

  func testFutureOrClosedSessionDoesNotStartLiveTimer() throws {
    let future = try runningSnapshot(open: "2026-03-09T09:00:00Z", at: "2026-03-08T09:00:00Z")
    let futureRunning = RunningDurationPresentation(
      snapshot: future, day: try XCTUnwrap(future.days.last))
    XCTAssertFalse(futureRunning.isRunning)
    XCTAssertEqual(futureRunning.durationMS(at: date("2026-03-10T09:00:00Z")), 0)
    let closed = try runningSnapshot(
      open: "2026-03-08T08:30:00Z", at: "2026-03-08T09:00:00Z", closed: true)
    XCTAssertFalse(
      RunningDurationPresentation(snapshot: closed, day: try XCTUnwrap(closed.days.last)).isRunning)
  }

  private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

  private func runningSnapshot(open: String, at: String, closed: Bool = false) throws
    -> PersonalAnalyticsSnapshot
  {
    let device = UUID()
    func event(_ sequence: Int64, _ transition: Transition, _ time: String) -> TrackingEvent {
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: sequence,
        generation: .initial, observedAtMS: Int64(date(time).timeIntervalSince1970 * 1000),
        timezoneID: "America/Los_Angeles", transition: transition, isTest: false,
        competitionEpochID: nil)
    }
    var events = [event(1, .open, open)]
    if closed { events.append(event(2, .close, at)) }
    let now = Int64(date(at).timeIntervalSince1970 * 1000)
    return try PersonalAnalytics.snapshot(
      events: events, generation: .initial,
      homeTimezone: "America/Los_Angeles", asOfMS: now,
      range: PersonalDateRange.trailingDays(1, throughMS: now, homeTimezone: "America/Los_Angeles"))
  }

  func testInvalidationRemovesActiveAndQueuedExports() {
    let model = FoldingPresentation()
    let first = UUID()
    model.present(.settings)
    model.present(.export(first))
    XCTAssertNil(model.sheet)
    XCTAssertEqual(Set(model.dismissExports()), [first])
    model.didDismissSheet()
    XCTAssertNil(model.sheet, "Invalidation must not open the queued export")
    let second = UUID()
    model.present(.export(second))
    XCTAssertEqual(Set(model.dismissExports()), [second])
    XCTAssertNil(model.sheet)
    model.present(.settings)
    XCTAssertTrue(model.dismissExports().isEmpty)
    XCTAssertEqual(model.sheet, .settings, "Unrelated modals stay intact")
  }

  func testExportCreationReturningAfterInvalidationIsCleanedWithoutPresentation() async throws {
    let model = FoldingPresentation()
    let ticket = UUID()
    var pending: CheckedContinuation<UUID, Error>?
    var cleaned: [UUID] = []
    var actions = actions()
    actions.export = { _ in try await withCheckedThrowingContinuation { pending = $0 } }
    actions.exportURL = { _ in
      XCTFail("Must not resolve a queued ticket")
      throw Failure.unavailable
    }
    actions.exportFinished = { cleaned.append($0) }
    let task = Task { await model.requestExport(.json, using: actions) }
    try await waitFor { pending != nil }
    model.dismissExports()
    pending!.resume(returning: ticket)
    await task.value
    XCTAssertEqual(cleaned, [ticket])
    XCTAssertNil(model.sheet)
    model.didDismissSheet()
    XCTAssertNil(model.sheet)
  }

  func testExportTicketWaitsForSettingsDismissalWithoutResolvingURL() async {
    let model = FoldingPresentation()
    let ticket = UUID()
    var actions = actions()
    actions.export = { _ in ticket }
    actions.exportURL = { _ in
      XCTFail("URL resolution belongs to active share host")
      throw Failure.unavailable
    }
    model.present(.settings)
    await model.requestExport(.csv, using: actions)
    XCTAssertNil(model.sheet)
    model.didDismissSheet()
    XCTAssertEqual(model.sheet, .export(ticket))
  }

  func testInvalidatedExportFailureDoesNotShowStaleError() async throws {
    let model = FoldingPresentation()
    var pending: CheckedContinuation<UUID, Error>?
    var actions = actions()
    actions.export = { _ in try await withCheckedThrowingContinuation { pending = $0 } }
    actions.exportURL = { _ in throw Failure.unavailable }
    let task = Task { await model.requestExport(.json, using: actions) }
    try await waitFor { pending != nil }
    model.dismissExports()
    pending!.resume(throwing: Failure.unavailable)
    await task.value
    XCTAssertNil(model.error)
  }

  func testHistoryRecoveryResetAvailabilityTracksAuthoritativeHealth() async {
    let model = FoldingPresentation()
    XCTAssertTrue(model.canResetHistory)
    model.privateHistoryHealth = .init(
      conflictingResetCount: 1,
      highestKnownResetRevision: .max, requiresAttention: true, canResetHistory: false)
    XCTAssertFalse(model.canResetHistory)
    var resets = 0
    var actions = self.actions()
    actions.reset = { resets += 1 }
    await model.requestReset(using: actions)
    XCTAssertEqual(resets, 0)
    XCTAssertEqual(model.privateHistoryHealth?.requiresAttention, true)
    model.privateHistoryHealth = .init(
      conflictingResetCount: 1,
      highestKnownResetRevision: 4, requiresAttention: false, canResetHistory: true)
    XCTAssertTrue(model.canResetHistory)
    XCTAssertEqual(model.privateHistoryHealth?.requiresAttention, false)
    await model.requestReset(using: actions)
    XCTAssertEqual(resets, 1)
  }

  func testTrackingPhoneStatusUsesExplicitSelectionOnly() throws {
    let model = FoldingPresentation()
    let local = UUID()
    let other = UUID()
    XCTAssertNil(model.trackingPhoneSelection)
    model.localDeviceID = local
    model.analytics = try phoneSnapshot(selected: nil, devices: [local, other])
    XCTAssertEqual(model.trackingPhoneSelection, .notSelected)
    XCTAssertEqual(model.analytics?.needsDeviceSelection, true)
    XCTAssertEqual(model.analytics?.lifetime.folds, 2, "Before selection neither source is hidden")
    model.analytics = try phoneSnapshot(selected: other, devices: [local, other])
    XCTAssertEqual(model.trackingPhoneSelection, .anotherPhone)
    model.analytics = try phoneSnapshot(selected: local, devices: [local, other])
    XCTAssertEqual(model.trackingPhoneSelection, .thisPhone)
  }

  func testPhoneSelectionWaitsForCommittedSnapshot() async throws {
    let model = FoldingPresentation()
    let local = UUID()
    model.localDeviceID = local
    model.analytics = try phoneSnapshot(selected: nil)
    var pending: CheckedContinuation<Void, Error>?
    var actions = actions()
    actions.useThisPhone = { try await withCheckedThrowingContinuation { pending = $0 } }
    let task = Task { await model.selectThisPhone(using: actions) }
    try await waitFor { pending != nil }
    XCTAssertEqual(model.trackingPhoneSelection, .notSelected)
    pending!.resume()
    await task.value
    XCTAssertEqual(
      model.trackingPhoneSelection, .notSelected,
      "Command completion cannot invent a durable selection")
    model.analytics = try phoneSnapshot(selected: local)
    XCTAssertEqual(model.trackingPhoneSelection, .thisPhone)
  }

  func testFailedPhoneSelectionPreservesExistingPhone() async throws {
    let model = FoldingPresentation()
    model.localDeviceID = UUID()
    model.analytics = try phoneSnapshot(selected: UUID())
    var actions = actions()
    actions.useThisPhone = { throw Failure.unavailable }
    await model.selectThisPhone(using: actions)
    XCTAssertEqual(model.trackingPhoneSelection, .anotherPhone)
    XCTAssertNotNil(model.error)
    XCTAssertNil(model.operation)
  }

  private func phoneSnapshot(selected: UUID?, devices: [UUID] = []) throws
    -> PersonalAnalyticsSnapshot
  {
    let events = devices.map { device in
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: 1,
        generation: .initial, observedAtMS: 1_000, timezoneID: "UTC", transition: .open,
        isTest: false, competitionEpochID: nil)
    }
    let markers =
      selected.map {
        [
          PrivateTransferMarker(
            transferID: UUID(), revision: 1,
            activeDeviceID: $0, sourceWatermarks: [:], createdAtMS: 2_000)
        ]
      } ?? []
    return try PersonalAnalytics.snapshot(
      events: events, generation: .initial, homeTimezone: "UTC",
      asOfMS: 2_000,
      range: PersonalDateRange.trailingDays(1, throughMS: 2_000, homeTimezone: "UTC"),
      transferMarkers: markers)
  }

  private func actions() -> FoldingActions {
    FoldingActions(
      refresh: {}, setup: { _ in throw Failure.unavailable }, savePreferences: { _ in })
  }

  private func history(_ title: String) -> HistoryPresentation {
    HistoryPresentation(
      title: title, folds: 0, completeDurationMS: 0, bins: [], sessions: [], canGoNext: false)
  }

  private func leaderboard(_ title: String) -> LeaderboardPresentation {
    LeaderboardPresentation(
      periodTitle: title, entries: [], currentUser: nil, updatedAt: Date())
  }

  private func waitFor(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(2)
    while !condition() {
      if ContinuousClock.now >= deadline { throw Failure.unavailable }
      await Task.yield()
    }
  }
}
