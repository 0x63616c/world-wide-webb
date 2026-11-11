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

    func testGridUsesHostTilesOnBothPagesAndKeepsUnavailableFallback() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL)
            .appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        // Independent fan is On while HVAC is Off: the old generic card showed Off.
        await transport.setFixture("fan/on.json", for: "controls.list")
        await transport.setFixture("climate/off.json", for: "climate.get")
        let calendar = HybridCalendarFixtureStore(root: root, unavailable: false)
        await calendar.setFilename("empty.json")
        let store = LiveHomeDataSource(
            configuration: PanelKit.PanelConfiguration(
                baseURL: URL(string: "http://localhost:18733")!), transport: transport,
            calendarAPI: CalendarAPI(store: calendar),
            now: { HybridCalendarFixtureStore.now })
        for module in HomeTile.panelProviders { await store.refresh(module) }
        defer { store.stop() }
        XCTAssertEqual(store.climate.mode, .off)
        XCTAssertEqual(store.fanProvider.fanOn, true)
        let host = PanelHomePresentation(
            store: store,
            session: PanelSession(
                configuration: PanelConfiguration(),
                nativeAlarms: NativeAlarmsRuntime(scheduler: FixtureAlarmScheduler())),
            navigation: PanelNavigation())
        for tile in [HomeTile.fan, .sound, .clock, .photos] {
            XCTAssertNotNil(host.gridTile(tile, span: HomeGrid.span(2, 2), open: {}), tile.id)
        }
        XCTAssertNotNil(host.gridTile(.climate, span: HomeGrid.span(2, 2), open: {}))
        let fanSpan = HomeGrid.span(2, 1)
        func fanImage() throws -> Data {
            let tile = try XCTUnwrap(host.gridTile(.fan, span: fanSpan, open: {}))
            let image = try TestBitmap.render(tile.environment(\.motionPhase, 0), size: fanSpan)
            return try XCTUnwrap(UIImage(cgImage: image).pngData())
        }
        let onImage = try fanImage()
        await transport.setFixture("fan/off.json", for: "controls.list")
        await store.refresh(.fan)
        XCTAssertEqual(store.fanProvider.fanOn, false)
        XCTAssertNotEqual(try fanImage(), onImage, "Grid content must reflect refreshed host state")
        await transport.setFixture("fan/on.json", for: "controls.list")
        await store.refresh(.fan)
        let probe = GridIntegrationProbe()
        let size = CGSize(width: 1366, height: 1024)
        for page in [0, 1] {
            let grid = GridHomeFace(store: store, size: size, page: page, open: { _ in })
                .environment(\.homeIntegration, probe)
            XCTAssertNotNil(ImageRenderer(content: grid).uiImage)
        }
        XCTAssertTrue(probe.gridTiles.contains(.fan))
        XCTAssertTrue(probe.gridTiles.contains(.sound), "Page 2 must use the same host hook")
        probe.unavailable = true
        probe.gridTiles = []
        probe.unavailableTiles = []
        XCTAssertNotNil(
            ImageRenderer(
                content: GridHomeFace(store: store, size: size, open: { _ in })
                    .environment(\.homeIntegration, probe)
            ).uiImage)
        XCTAssertTrue(probe.unavailableTiles.contains(.fan))
        XCTAssertFalse(probe.gridTiles.contains(.fan), "Unavailable wins over custom live content")
    }

    func testHomeWallpaperAndSkyAreInPanelBundle() {
        XCTAssertNotNil(UIImage(named: "LakeWallpaper"))
        XCTAssertNotNil(UIImage(named: "CloudPhoto"))
        XCTAssertNotNil(UIImage(named: "ForestPhoto"))
        XCTAssertNotNil(UIImage(named: "CoastPhoto"))
    }
}

/// Records dispatch without relying on any particular GridCard implementation.
@MainActor private final class GridIntegrationProbe: HomeIntegration {
    let caption = ""
    var unavailable = false
    var gridTiles: Set<HomeTile> = []
    var unavailableTiles: Set<HomeTile> = []
    func prepareToOpen(_ tile: HomeTile) -> Bool { true }
    func available(_ tile: HomeTile) -> Bool { !unavailable }
    func tile(_ tile: HomeTile, open: @escaping () -> Void) -> AnyView? {
        unavailableTiles.insert(tile)
        return AnyView(Text("Unavailable"))
    }
    func gridTile(_ tile: HomeTile, span: CGSize, open: @escaping () -> Void) -> AnyView? {
        gridTiles.insert(tile)
        return AnyView(Text(tile.title).padding(HomeGrid.inset))
    }
    func musicFace(close: @escaping () -> Void) -> AnyView { AnyView(EmptyView()) }
    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView { AnyView(EmptyView()) }
}
