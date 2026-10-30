import Foundation
import PanelKit
import XCTest
@testable import Panel

@MainActor private final class AlarmSchedulerSpy: NativeAlarmScheduling {
    var events: [String] = []
    var authorized = true
    var failCancel = false
    func authorize() async throws -> Bool { events.append("authorize"); return authorized }
    func sync(_ snapshot: AlarmsSnapshot) async throws { events.append("schedule") }
    func cancel() throws {
        events.append("cancel")
        if failCancel { throw NativeAlarmFailure.unavailable }
    }
}

@MainActor final class NativeAlarmsRuntimeTests: XCTestCase {
    private func snapshot(_ name: String) async throws -> AlarmsSnapshot {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        await transport.setFixture("alarms/\(name).json", for: "alarms.list")
        return try await AlarmsAPI(client: PanelAPIClient(configuration: PanelKit.PanelConfiguration(baseURL: URL(string: "https://alarms.example.invalid")!), transport: transport)).list()
    }

    func testHandoffAcknowledgedBeforeScheduleAndCancelBeforeWebResume() async throws {
        let driver = AlarmSchedulerSpy()
        let runtime = NativeAlarmsRuntime(scheduler: driver)
        let value = try await snapshot("scheduled")
        await runtime.reconcile(snapshot: value, available: true, configured: true,
            handoff: { driver.events.append($0 ? "web-muted" : "web-resumed"); return true },
            syncWidget: { _ in driver.events.append("widget") })
        XCTAssertEqual(driver.events, ["authorize", "web-muted", "schedule", "widget"])
        XCTAssertTrue(runtime.ownsRinging)
        driver.events = []
        await runtime.release { driver.events.append($0 ? "web-muted" : "web-resumed"); return true }
        XCTAssertEqual(driver.events, ["cancel", "web-resumed"])
        XCTAssertFalse(runtime.ownsRinging)
    }

    func testOldWebCannotEnableNativeRingerAndDeniedAuthorizationFallsBack() async throws {
        let driver = AlarmSchedulerSpy()
        let runtime = NativeAlarmsRuntime(scheduler: driver)
        let value = try await snapshot("scheduled")
        await runtime.reconcile(snapshot: value, available: true, configured: true,
            handoff: { _ in false }, syncWidget: { _ in XCTFail("No widget sync") })
        XCTAssertFalse(runtime.ownsRinging)
        XCTAssertFalse(driver.events.contains("schedule"))
        driver.authorized = false
        await runtime.reconcile(snapshot: value, available: true, configured: true,
            handoff: { native in XCTAssertFalse(native); return true }, syncWidget: { _ in XCTFail() })
        XCTAssertFalse(runtime.ownsRinging)
    }

    func testFailedCancellationNeverResumesWebRinging() async throws {
        let driver = AlarmSchedulerSpy()
        let runtime = NativeAlarmsRuntime(scheduler: driver)
        await runtime.reconcile(snapshot: try await snapshot("empty"), available: true, configured: true,
            handoff: { _ in true }, syncWidget: { _ in })
        driver.failCancel = true
        await runtime.release { _ in XCTFail("Would double-ring"); return true }
        XCTAssertTrue(runtime.ownsRinging)
        XCTAssertThrowsError(try runtime.prepareNavigation())
    }

    func testUnavailableProviderReleasesAndWidgetOnlyUpdatesWhenNextChanges() async throws {
        let driver = AlarmSchedulerSpy()
        let runtime = NativeAlarmsRuntime(scheduler: driver)
        let value = try await snapshot("scheduled")
        var widgets = 0
        for _ in 0..<2 {
            await runtime.reconcile(snapshot: value, available: true, configured: true,
                handoff: { _ in true }, syncWidget: { _ in widgets += 1 })
        }
        XCTAssertEqual(widgets, 1)
        await runtime.reconcile(snapshot: value, available: false, configured: true,
            handoff: { native in XCTAssertFalse(native); return true }, syncWidget: { _ in XCTFail() })
        XCTAssertFalse(runtime.ownsRinging)
    }

    func testDeliveryUsesServerNextAndMatchesOnlyExactOccurrence() async throws {
        let now = AlarmDate.parse("2099-01-01T07:00:01Z")!
        let scheduled = try await snapshot("scheduled")
        let planned = try XCTUnwrap(AlarmDelivery.next(in: scheduled, now: now))
        XCTAssertEqual(planned.sourceID, "alm_example")
        XCTAssertEqual(planned.at, "2099-01-02T07:00:00.000Z")
        let ringing = try await snapshot("ringing")
        let delivery = try XCTUnwrap(AlarmDelivery.next(in: ringing, now: now))
        XCTAssertTrue(delivery.matches(ringing.active[0]))
        XCTAssertFalse(planned.matches(ringing.active[0]))
        let snoozeSnapshot = try await snapshot("snoozed")
        let snoozed = try XCTUnwrap(AlarmDelivery.next(in: snoozeSnapshot, now: now))
        XCTAssertEqual(snoozed.sourceID, "alr_example")
        XCTAssertEqual(snoozed.at, "2099-01-01T07:09:01.000Z")
        XCTAssertNil(snoozed.version)
        let reringing = try await snapshot("reringing")
        XCTAssertFalse(delivery.matches(reringing.active[0]))
    }
}
