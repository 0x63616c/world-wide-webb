import FoldingDomain
import XCTest

@testable import Folding

@MainActor final class PresentationTests: XCTestCase {
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
      periodTitle: title, entries: [], currentUser: nil, pendingFolds: 0, updatedAt: Date())
  }

  private func waitFor(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(2)
    while !condition() {
      if ContinuousClock.now >= deadline { throw Failure.unavailable }
      await Task.yield()
    }
  }
}
