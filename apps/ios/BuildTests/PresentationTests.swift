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
