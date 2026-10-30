import Foundation
import PanelKit
import SwiftUI
import UIKit
import XCTest
@testable import Panel

@MainActor final class LiveWalkRoutingTests: XCTestCase {
    private let localNow = ISO8601DateFormatter().date(from: "2026-10-01T12:02:00Z")!

    private func transport() throws -> HybridFixtureTransport {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        return HybridFixtureTransport(root: root)
    }

    private func source(_ transport: HybridFixtureTransport, clock: SyncClock? = nil) -> LiveHomeDataSource {
        LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://fixtures.example.invalid/panel")!,
            accessClientID: "synthetic-access-id", accessClientSecret: "synthetic-access-secret"),
            transport: transport, now: { self.localNow }, walkClock: clock)
    }

    func testWalkRoutesOnlyWithNativeFlagAndCurrentStateIncludingEmptyHistory() async throws {
        let transport = try transport()
        let store = source(transport)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.walk": "native"]))
        func route() -> HybridRouter.Route { router.route(for: .walk, hasLiveData: store.hasLiveData(for: .walk)) }
        XCTAssertEqual(route(), .webBoard)
        await transport.setFixture("walks/history-empty.json", for: "walks.history")
        await store.refresh(.walk)
        XCTAssertEqual(route(), .native(.walk), "A configured service with no walks is usable.")
        XCTAssertTrue(store.walks === store.walkProvider)
        XCTAssertNil(store.walks.activeWalk)
        XCTAssertTrue(store.walks.history.isEmpty)
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .walk, hasLiveData: true), .webBoard)
        XCTAssertEqual(HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.walk": "web"],
            nativeByDefault: ModuleFlags.shippedNative)).route(for: .walk, hasLiveData: true), .webBoard)

        await transport.setFixture("walks/state-active.json", for: "walks.state")
        await store.refresh(.walk)
        let active = try XCTUnwrap(store.walks.activeWalk)
        XCTAssertEqual(route(), .native(.walk))
        await transport.setFixture("walks/unavailable.json", for: "walks.state")
        await store.refresh(.walk)
        XCTAssertEqual(route(), .webBoard)
        XCTAssertEqual(store.walks.activeWalk, active, "A retained snapshot must not keep the route native.")
        await transport.setFixture("walks/stop.json", for: "walks.state")
        await store.refresh(.walk)
        XCTAssertEqual(route(), .native(.walk))
        XCTAssertNil(store.walks.activeWalk)
        let missing = LiveHomeDataSource(configuration: nil, transport: transport)
        await missing.refresh(.walk)
        XCTAssertFalse(missing.hasLiveData(for: .walk))
    }

    func testWalkUsesPanelConfigurationAndServerClockWithoutChangingOtherModules() async throws {
        let transport = try transport()
        let store = source(transport)
        await store.refresh(.walk)
        let requests = await transport.requests
        XCTAssertEqual(requests.map { $0.url!.path }, ["/panel/trpc/walks.state", "/panel/trpc/walks.history"])
        for request in requests {
            XCTAssertEqual(request.url?.host, "fixtures.example.invalid")
            XCTAssertEqual(request.value(forHTTPHeaderField: "CF-Access-Client-Id"), "synthetic-access-id")
            XCTAssertEqual(request.value(forHTTPHeaderField: "CF-Access-Client-Secret"), "synthetic-access-secret")
        }
        let presentation = HybridWalkDataSource(store: store)
        XCTAssertEqual(store.now, localNow)
        XCTAssertEqual(presentation.now, localNow.addingTimeInterval(-120))
        XCTAssertEqual(presentation.walks.summary(at: presentation.now).weeklyMinutes, 80)

        await transport.setFixture("walks/start.json", for: "walks.start")
        presentation.walks.start(at: presentation.now)
        XCTAssertTrue(store.walkProvider.isMutating)
        XCTAssertEqual(store.walks.activeWalk?.startedAt, presentation.now, "Apply server offset exactly once.")
        presentation.walks.start(at: presentation.now) // Duplicate tap is ignored by the provider.
        try await waitFor { !store.walkProvider.isMutating && store.walkProvider.historyAvailability == .live }
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(writes.count, 1)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(writes.first?.httpBody)) as? [String: Any])
        XCTAssertEqual(body["source"] as? String, "ipad")
        XCTAssertNil(body["startedAt"], "The server owns the authoritative start time.")
        await transport.setFixture("walks/stop.json", for: "walks.stop")
        presentation.walks.stop(at: presentation.now)
        XCTAssertEqual(store.walks.history.first?.endedAt, presentation.now)
        try await waitFor { !store.walkProvider.isMutating }
        XCTAssertNil(store.walks.activeWalk)
        XCTAssertEqual(store.now, localNow)
    }

    func testRunUsesWalkCoordinatorCadenceAndCancelsThenRefreshesOnResume() async throws {
        let transport = try transport()
        let clock = HybridWalkClock(date: localNow)
        let store = source(transport, clock: clock.value)
        await store.run(modules: [])
        var requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
        let task = Task { await store.run(modules: [.walk]) }
        defer { task.cancel(); store.stop() }
        try await waitFor { store.hasLiveData(for: .walk) && clock.waiting }
        requests = await transport.requests
        XCTAssertEqual(requests.map { $0.url!.lastPathComponent }, ["walks.state", "walks.history"])
        XCTAssertEqual(clock.delay, .seconds(4))
        await transport.setFixture("walks/state-active.json", for: "walks.state")
        clock.advance()
        try await waitFor { store.walks.activeWalk != nil && clock.waiting }
        task.cancel()
        await task.value
        try await waitFor { !clock.waiting }
        let stopped = await transport.requests.count
        clock.advance()
        await Task.yield()
        requests = await transport.requests
        XCTAssertEqual(requests.count, stopped)
        await transport.setFixture("walks/stop.json", for: "walks.state")
        let resumed = Task { await store.run(modules: [.walk]) }
        defer { resumed.cancel(); store.stop() }
        try await waitFor { store.walks.activeWalk == nil && clock.waiting }
        store.stop()
        try await waitFor { !clock.waiting }
        resumed.cancel()
        await resumed.value
    }

    func testWalkTileAndDetailRenderAtPanelSize() async throws {
        let transport = try transport()
        let store = source(transport)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let canvas = CGSize(width: 1366, height: 1024)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: canvas)
        window.windowLevel = .alert + 1
        defer { window.isHidden = true; window.rootViewController = nil }
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WalkVerification")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for active in [false, true] {
            await transport.setFixture(active ? "walks/state-active.json" : "walks/state-idle.json", for: "walks.state")
            await store.refresh(.walk)
            XCTAssertTrue(store.hasLiveData(for: .walk))
            for detail in [false, true] {
                let view = HybridNativeModule(module: .walk, store: store, detail: detail, open: {})
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
                let name = "walk-\(active ? "active" : "idle")-\(detail ? "detail" : "tile")"
                try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("\(name).png"))
                let attachment = XCTAttachment(image: image)
                attachment.name = name; attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    func testCancellingOldSceneTaskDoesNotStopNewForegroundRun() async throws {
        let transport = try transport()
        let clock = HybridWalkClock(date: localNow)
        let store = source(transport, clock: clock.value)
        let old = Task { await store.run(modules: [.walk]) }
        defer { old.cancel(); store.stop() }
        try await waitFor { store.hasLiveData(for: .walk) && clock.waiting }
        store.stop()
        try await waitFor { !clock.waiting }
        await transport.setFixture("walks/state-active.json", for: "walks.state")
        let foreground = Task { await store.run(modules: [.walk]) }
        defer { foreground.cancel(); store.stop() }
        try await waitFor { store.walks.activeWalk != nil && clock.waiting }
        old.cancel()
        await old.value
        await transport.setFixture("walks/stop.json", for: "walks.state")
        clock.advance()
        try await waitFor { store.walks.activeWalk == nil && clock.waiting }
        foreground.cancel()
        await foreground.value
        try await waitFor { !clock.waiting }
    }

    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Walk provider did not settle")
        throw URLError(.timedOut)
    }
}

@MainActor private final class HybridWalkClock {
    private var date: Date
    private var elapsed: Duration = .zero
    private var sleeper: CheckedContinuation<Void, any Error>?
    private(set) var delay: Duration = .zero
    var waiting: Bool { sleeper != nil }
    init(date: Date) { self.date = date }
    var value: SyncClock {
        SyncClock(now: { self.date }, elapsed: { self.elapsed }, sleep: { delay in
            self.delay = delay
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { self.sleeper = $0 }
            } onCancel: {
                Task { @MainActor in
                    let pending = self.sleeper
                    self.sleeper = nil
                    pending?.resume(throwing: CancellationError())
                }
            }
        })
    }
    func advance() {
        elapsed += delay
        date += Double(delay.components.seconds)
        let pending = sleeper
        sleeper = nil
        pending?.resume()
    }
}
