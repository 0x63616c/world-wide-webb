import PanelKit
import SwiftUI
import UIKit
import XCTest

@testable import Panel

@MainActor final class HomeViewIntegrationTests: XCTestCase {
    func testEveryHomeTileMapsToAnExistingProviderAndController() {
        XCTAssertEqual(HomeTile.panelProviders, Set(PanelModule.allCases))
        for tile in HomeTile.allCases {
        }
        XCTAssertEqual(HomeTile.clock.panelModule, .alarms)
        XCTAssertEqual(HomeTile.all.panelModule, .lights)
        XCTAssertEqual(HomeTile.sonosRooms.panelModule, .sonos)
    }

    func testEveryDestinationRendersWithLiveAndUnavailableProviders() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL)
            .appendingPathComponent("Fixtures")
        let configuration = PanelKit.PanelConfiguration(baseURL: URL(string: "http://localhost:18733")!)
        for unavailable in [false, true] {
            let store = LiveHomeDataSource(
                configuration: configuration,
                transport: HybridFixtureTransport(root: root, unavailable: unavailable),
                calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root: root, unavailable: unavailable)),
                now: { HybridCalendarFixtureStore.now }, calendar: { HybridCalendarFixtureStore.calendar })
            for module in HomeTile.panelProviders {
                await store.refresh(module)
                if !unavailable { XCTAssertTrue(store.hasLiveData(for: module), module.rawValue) }
            }
            let runtime = NativeAlarmsRuntime(scheduler: FixtureAlarmScheduler())
            await runtime.reconcile(
                snapshot: store.alarmsProvider.snapshot,
                available: store.hasLiveData(for: .alarms), configured: true,
                syncWidget: { _ in })
            let session = PanelSession(configuration: PanelConfiguration(), nativeAlarms: runtime)
            for tile in HomeTile.allCases {
                let view = PanelHomeDestination(
                    module: tile.panelModule, store: store,
                    session: session, close: {}
                )
                .environment(\.horizontalSizeClass, .regular)
                .frame(width: 1366, height: 1024)
                XCTAssertNotNil(ImageRenderer(content: view).uiImage, "\(tile.rawValue), unavailable=\(unavailable)")
            }
            store.stop()
        }
    }

    func testSkyIsInPanelBundle() {
        XCTAssertNotNil(UIImage(named: "CloudPhoto"))
    }
}
