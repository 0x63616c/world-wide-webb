import Foundation
import PanelKit
import SwiftUI
import UIKit
import XCTest
@testable import Panel

@MainActor final class LiveCalendarRoutingTests: XCTestCase {
    func testCalendarIsWebByDefaultInShippedBuilds() {
        XCTAssertFalse(ModuleFlags.shippedNative.contains(.calendar))
        XCTAssertEqual(ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)[.calendar], .web)
    }

    func testSelectionUpdatesSharedHomeAgendaAndKeepsEmptyModuleReachable() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let suite = "LiveCalendarSelectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = LiveHomeDataSource(configuration: nil,
            calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root: root),
                                     selection: CalendarSelection(suiteName: suite)),
            now: { HybridCalendarFixtureStore.now }, calendar: { HybridCalendarFixtureStore.calendar })
        await store.refresh(.calendar)
        XCTAssertEqual(store.calendar.next(at: store.now)?.title, "Design workshop")
        await store.calendarProvider.setCalendarShown(false, identifier: "fixture_work")
        XCTAssertFalse(store.calendar.events.contains { $0.title == "Design workshop" })
        XCTAssertNotEqual(store.calendar.next(at: store.now)?.title, "Design workshop")
        XCTAssertTrue(store.calendar.events.contains { $0.title == "Community day" })
        await store.calendarProvider.setCalendarShown(false, identifier: "fixture_personal")
        XCTAssertTrue(store.calendar.events.isEmpty)
        XCTAssertNil(store.calendar.next(at: store.now))
        XCTAssertTrue(store.hasLiveData(for: .calendar), "Keep the picker reachable when all calendars are hidden.")
        await store.calendarProvider.showAllCalendars()
        XCTAssertEqual(store.calendar.events.count, 7)
        XCTAssertEqual(store.calendar.next(at: store.now)?.title, "Design workshop")
    }

    func testCalendarSurfacesRenderAtPanelSize() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let store = LiveHomeDataSource(configuration: nil,
            calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root: root)),
            now: { HybridCalendarFixtureStore.now }, calendar: { HybridCalendarFixtureStore.calendar })
        await store.refresh(.calendar)
        XCTAssertTrue(store.hasLiveData(for: .calendar))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let canvas = CGSize(width: 1366, height: 1024)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: canvas)
        window.windowLevel = .alert + 1
        defer { window.isHidden = true; window.rootViewController = nil }
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CalendarVerification")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for detail in [false, true] {
            let view = HybridNativeModule(module: .calendar, store: store, detail: detail, open: {})
                .frame(width: canvas.width, height: canvas.height)
                .environment(\.horizontalSizeClass, .regular).ignoresSafeArea()
            let host = UIHostingController(rootView: view)
            host.safeAreaRegions = []
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.frame = window.bounds
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(700))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1; format.opaque = true
            var rendered = false
            let image = UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
                rendered = host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            XCTAssertTrue(rendered)
            XCTAssertEqual(image.cgImage?.width, 1366)
            XCTAssertEqual(image.cgImage?.height, 1024)
            let name = detail ? "calendar-page" : "calendar-home-tile"
            try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("\(name).png"))
            let attachment = XCTAttachment(image: image)
            attachment.name = name; attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testCalendarOptInAllowsEmptyCurrentFeedAndRecovers() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let fixture = HybridCalendarFixtureStore(root: root)
        var now = HybridCalendarFixtureStore.now
        let store = LiveHomeDataSource(configuration: nil, calendarAPI: CalendarAPI(store: fixture),
                                       now: { now }, calendar: { HybridCalendarFixtureStore.calendar })
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.calendar": "native"]))
        func route() -> HybridRouter.Route { router.route(for: .calendar, hasLiveData: store.hasLiveData(for: .calendar)) }
        await store.run(modules: [])
        let reads = await fixture.reads
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(route(), .webBoard)
        await store.refresh(.calendar)
        XCTAssertEqual(route(), .native(.calendar))
        XCTAssertEqual(store.calendar.next(at: store.now)?.title, "Design workshop")
        XCTAssertEqual(store.calendar.events.count, 7)
        now = now.addingTimeInterval(1)
        XCTAssertEqual(store.now, now, "The Home clock must advance between Calendar polls.")
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .calendar, hasLiveData: true), .webBoard)
        await fixture.setUnavailable(true)
        await store.refresh(.calendar)
        XCTAssertEqual(route(), .webBoard)
        XCTAssertTrue(store.calendar.events.isEmpty)
        await fixture.setUnavailable(false)
        await fixture.setFilename("empty.json")
        await store.refresh(.calendar)
        XCTAssertEqual(route(), .native(.calendar))
        await fixture.setFilename("events.json")
        await store.refresh(.calendar)
        XCTAssertEqual(route(), .native(.calendar))
        store.stop()
        XCTAssertEqual(route(), .webBoard)
        XCTAssertTrue(store.calendar.events.isEmpty)
    }
}
