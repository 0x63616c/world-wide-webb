import Foundation
import UserNotifications
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
        XCTAssertEqual(UpdateBanner.testFlightURL.absoluteString, "itms-beta://")
    }

    private func silentNotifications() -> UpdateNotifications {
        UpdateNotifications(authorization: { .denied }, post: { _ in XCTFail("Must not notify") })
    }
}

@MainActor final class UpdateNotificationsTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: "WWW53.UpdateNotificationsTests")!
        defaults.removePersistentDomain(forName: "WWW53.UpdateNotificationsTests")
        addTeardownBlock { UserDefaults(suiteName: "WWW53.UpdateNotificationsTests")?.removePersistentDomain(forName: "WWW53.UpdateNotificationsTests") }
        return defaults
    }

    func testAuthorizedAndProvisionalNotifyOncePerBuildAcrossRestarts() async {
        for status in [UNAuthorizationStatus.authorized, .provisional] {
            let defaults = defaults()
            var posted: [Int] = []
            let notifications = UpdateNotifications(defaults: defaults, authorization: { status }, post: { posted.append($0) })
            await notifications.notify(build: 10)
            await notifications.notify(build: 10)
            await notifications.notify(build: 9)
            let restarted = UpdateNotifications(defaults: defaults, authorization: { status }, post: { posted.append($0) })
            await restarted.notify(build: 10)
            await restarted.notify(build: 11)
            XCTAssertEqual(posted, [10, 11])
            XCTAssertEqual(defaults.integer(forKey: UpdateNotifications.lastBuildKey), 11)
        }
    }

    func testOtherAuthorizationStatesNeverPostOrRemember() async {
        for status in [UNAuthorizationStatus.notDetermined, .denied, .ephemeral] {
            let defaults = defaults()
            let notifications = UpdateNotifications(defaults: defaults, authorization: { status }, post: { _ in XCTFail("Must not notify") })
            await notifications.notify(build: 10)
            XCTAssertEqual(defaults.integer(forKey: UpdateNotifications.lastBuildKey), 0)
        }
    }

    func testFailureCanRetryAndAuthorizationCanBeGrantedLater() async {
        let defaults = defaults()
        var status = UNAuthorizationStatus.denied
        var fail = true
        var attempts = 0
        let notifications = UpdateNotifications(defaults: defaults, authorization: { status }, post: { _ in
            attempts += 1
            if fail { throw NSError(domain: "test", code: 1) }
        })
        await notifications.notify(build: 10)
        XCTAssertEqual(attempts, 0)
        status = .authorized
        await notifications.notify(build: 10)
        XCTAssertEqual(defaults.integer(forKey: UpdateNotifications.lastBuildKey), 0)
        fail = false
        await notifications.notify(build: 10)
        await notifications.notify(build: 10)
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(defaults.integer(forKey: UpdateNotifications.lastBuildKey), 10)
    }

    func testOverlappingChecksDeduplicate() async {
        let defaults = defaults()
        var posted: [Int] = []
        let notifications = UpdateNotifications(defaults: defaults, authorization: {
            await Task.yield()
            return .authorized
        }, post: { posted.append($0) })
        let first = Task { await notifications.notify(build: 10) }
        let second = Task { await notifications.notify(build: 10) }
        await first.value
        await second.value
        XCTAssertEqual(posted, [10])
    }
}
