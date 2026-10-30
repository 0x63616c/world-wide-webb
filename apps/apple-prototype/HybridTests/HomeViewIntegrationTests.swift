import XCTest
import UIKit
import SwiftUI
import PanelKit
@testable import Panel

@MainActor final class HomeViewIntegrationTests: XCTestCase {
    func testEveryHomeTileMapsToAnExistingProviderAndController() {
        XCTAssertEqual(HomeTile.panelProviders, Set(PanelModule.allCases).subtracting([.all, .reminders]))
        for tile in HomeTile.allCases {
            XCTAssertNotEqual(tile.panelModule, .all, tile.rawValue)
            XCTAssertNotEqual(tile.panelModule, .reminders, tile.rawValue)
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
            let store = LiveHomeDataSource(configuration: configuration,
                transport: HybridFixtureTransport(root: root, unavailable: unavailable),
                mediaAPI: HybridMediaFixture(unavailable: unavailable),
                calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root: root, unavailable: unavailable)),
                now: { HybridCalendarFixtureStore.now }, calendar: { HybridCalendarFixtureStore.calendar })
            for module in HomeTile.panelProviders {
                await store.refresh(module)
                if !unavailable { XCTAssertTrue(store.hasLiveData(for: module), module.rawValue) }
            }
            let runtime = NativeAlarmsRuntime(scheduler: FixtureAlarmScheduler())
            await runtime.reconcile(snapshot: store.alarmsProvider.snapshot,
                available: store.hasLiveData(for: .alarms), configured: true,
                handoff: { _ in true }, syncWidget: { _ in })
            let session = KioskSession(configuration: PanelConfiguration(), nativeAlarms: runtime)
            let router = HybridRouter(flags: ModuleFlags(nativeByDefault: HomeTile.panelProviders))
            for tile in HomeTile.allCases {
                let view = PanelHomeDestination(module: tile.panelModule, store: store,
                    session: session, router: router, close: {}, classic: {})
                    .environment(\.horizontalSizeClass, .regular)
                    .frame(width: 1366, height: 1024)
                XCTAssertNotNil(ImageRenderer(content: view).uiImage, "\(tile.rawValue), unavailable=\(unavailable)")
            }
            store.stop()
        }
    }

    func testHomeWallpaperAndSkyAreInPanelBundle() {
        XCTAssertNotNil(UIImage(named: "LakeWallpaper"))
        XCTAssertNotNil(UIImage(named: "CloudPhoto"))
        XCTAssertNil(UIImage(named: "ForestPhoto"))
        XCTAssertNil(UIImage(named: "CoastPhoto"))
    }
}
