import Foundation
import PanelKit
import XCTest

@testable import Panel

@MainActor final class HostStatusCheckerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let nasDown = HostNotice(
        key: "host-nas", title: "NAS unavailable", body: "Backups and Mini updates are paused.")
    private let deployPaused = HostNotice(
        key: "host-deploy", title: "Mini updates paused", body: "New versions aren’t being installed.")

    func testReconcileShowsOnlyCurrentNoticesAndClearsRecoveredOnes() {
        let center = Panel.NotificationCenter()
        center.reconcileHost([nasDown])
        center.reconcileHost([nasDown])
        XCTAssertEqual(center.history.map(\.title), ["NAS unavailable"])
        let item = center.history[0]
        XCTAssertTrue(item.isPersistent)
        XCTAssertEqual(item.deepLink, PanelNotificationLinks.diagnostics)
        center.reconcileHost([deployPaused])
        XCTAssertEqual(center.history.map(\.title), ["Mini updates paused"])
        center.reconcileHost([])
        XCTAssertTrue(center.history.isEmpty)
    }

    func testHostNoticesStayAboveNewerNotifications() {
        var clock = now
        let center = Panel.NotificationCenter(now: { clock })
        center.reconcileHost([nasDown])
        clock += 60
        center.post(sourceModule: "alarms", title: "Wake up", body: "", deepLink: "module/alarms", priority: .critical)
        XCTAssertEqual(
            NotificationBannerStack.ordered(center.bannerGroups).map(\.title), ["NAS unavailable", "Wake up"])
        XCTAssertEqual(center.history.map(\.title), ["NAS unavailable", "Wake up"])
    }

    func testFailedFetchKeepsLastNoticesAndPollingRepeats() async {
        let center = Panel.NotificationCenter()
        var result: Result<HostStatus, Error> = .success(
            HostStatus(
                nas: .init(state: "failing", since: now - 3_600, reason: "The Mini can’t reach the NAS"),
                deploy: .init(state: "blocked", since: now - 3_000)))
        var sleeps = 0
        let checker = HostStatusChecker(
            notifications: center, now: { self.now }, fetch: { try result.get() },
            sleep: { _ in
                sleeps += 1
                if sleeps == 2 { throw CancellationError() }
            })
        await checker.run()
        XCTAssertEqual(sleeps, 2)
        XCTAssertEqual(center.history.map(\.title), ["NAS unavailable"])
        result = .failure(PanelAPIError.transport("offline"))
        await checker.check()
        XCTAssertEqual(center.history.map(\.title), ["NAS unavailable"])
        result = .success(HostStatus(nas: .init(state: "ok"), deploy: .init(state: "ok")))
        await checker.check()
        XCTAssertTrue(center.history.isEmpty)
    }

    func testDiagnosticsRowsExplainEachCheck() {
        let rows = PanelDiagnosticsView.hostRows(
            HostStatus(
                nas: .init(state: "failing", since: now - 7_200, reason: "The NAS rejected the Mini’s login"),
                deploy: .init(state: "ok")),
            now: now)
        XCTAssertEqual(rows.map(\.status), ["Unavailable", "Installing"])
        XCTAssertTrue(rows[0].reason?.hasPrefix("The NAS rejected the Mini’s login. Since ") == true)
        let stale = PanelDiagnosticsView.hostRows(
            HostStatus(nas: .init(state: "ok"), deploy: .init(state: "ok"), stale: true), now: now)
        XCTAssertEqual(stale.map(\.status), ["Not reporting"])
    }
}
