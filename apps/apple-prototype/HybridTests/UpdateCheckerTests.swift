import Foundation
import XCTest
@testable import Panel

@MainActor final class UpdateCheckerTests: XCTestCase {
    func testBuildComparison() {
        XCTAssertEqual(UpdateChecker.newerBuild(server: 100, current: "99"), 100)
        XCTAssertNil(UpdateChecker.newerBuild(server: 99, current: "99"))
        XCTAssertNil(UpdateChecker.newerBuild(server: 98, current: "99"))
        for current in ["", "99.1", "beta", "-1", " 99", "99999999999999999999999999999"] {
            XCTAssertNil(UpdateChecker.newerBuild(server: 100, current: current), current)
        }
    }

    func testLaunchPollingAndForegroundTriggerImmediateChecks() async {
        var fetches = 0
        var sleeps: [TimeInterval] = []
        let checker = UpdateChecker(currentBuild: "1", notifications: silentNotifications(), fetchBuild: {
            fetches += 1
            return 10
        }, sleep: { seconds in
            sleeps.append(seconds)
            if sleeps.count >= 2 { throw CancellationError() }
        })
        await checker.run() // Launch, then the injected interval elapses once.
        XCTAssertEqual(fetches, 2)
        XCTAssertEqual(sleeps, [900, 900])
        XCTAssertEqual(checker.availableBuild, 10)
        await checker.run() // A new foreground task checks before waiting again.
        XCTAssertEqual(fetches, 3)
        XCTAssertEqual(sleeps, [900, 900, 900])
    }

    func testDebugIntervalAndFailureRecovery() async {
        var fail = false
        var intervals: [TimeInterval] = []
        let checker = UpdateChecker(currentBuild: "1", interval: 2, notifications: silentNotifications(), fetchBuild: {
            if fail { throw NSError(domain: "missing-or-offline", code: 404) }
            return 10
        }, sleep: { seconds in intervals.append(seconds); throw CancellationError() })
        await checker.run()
        XCTAssertEqual(intervals, [2])
        XCTAssertEqual(checker.availableBuild, 10)
        fail = true
        await checker.check()
        XCTAssertNil(checker.availableBuild)
        fail = false
        await checker.check()
        XCTAssertEqual(checker.availableBuild, 10)
    }

    func testEqualOrOlderReleaseClearsBanner() async {
        var build = 10
        let checker = UpdateChecker(currentBuild: "5", notifications: silentNotifications(), fetchBuild: { build })
        await checker.check()
        XCTAssertEqual(checker.availableBuild, 10)
        build = 5
        await checker.check()
        XCTAssertNil(checker.availableBuild)
        build = 4
        await checker.check()
        XCTAssertNil(checker.availableBuild)
    }

    func testCancelledFetchCannotPublishLateResult() async {
        let checker = UpdateChecker(currentBuild: "1", notifications: silentNotifications(), fetchBuild: {
            withUnsafeCurrentTask { $0?.cancel() }
            return 10
        })
        let task = Task { await checker.check() }
        await task.value
        XCTAssertNil(checker.availableBuild)
    }

    func testTestFlightDestination() {
        XCTAssertEqual(PanelNotifications.testFlightURL.absoluteString, "itms-beta://")
    }

    func testUpdateUsesSharedHistoryAndDoesNotReplayAfterRestart() async {
        let center = Panel.NotificationCenter()
        let checker = UpdateChecker(currentBuild: "1", notifications: center, fetchBuild: { 10 })
        await checker.check()
        await checker.check()
        XCTAssertEqual(center.history.count, 1)
        XCTAssertEqual(center.history.first?.deepLink, PanelNotifications.updateDeepLink)
        XCTAssertEqual(center.history.first?.sourceModule, "updates")
        let feedback = center.arrivalFeedback
        let restarted = UpdateChecker(currentBuild: "1", notifications: center, fetchBuild: { 10 })
        await restarted.check()
        XCTAssertEqual(center.arrivalFeedback, feedback)
        let newer = UpdateChecker(currentBuild: "1", notifications: center, fetchBuild: { 11 })
        await newer.check()
        XCTAssertEqual(center.history.count, 2)
    }

    private func silentNotifications() -> Panel.NotificationCenter { Panel.NotificationCenter() }
}
