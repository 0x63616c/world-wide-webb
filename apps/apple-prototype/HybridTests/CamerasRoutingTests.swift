import Foundation
import XCTest
import PanelKit
@testable import Panel

@MainActor final class CamerasRoutingTests: XCTestCase {
    func testCameraOptInRequiresDataAndRecoversFromMissingBackend() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        let store = LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://fixture.example.invalid")!), transport: transport)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.cameras": "native"]))
        XCTAssertEqual(ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)[.cameras], .web)
        XCTAssertEqual(router.route(for: .cameras, hasLiveData: store.hasLiveData(for: .cameras)), .webBoard)
        await store.refresh(.cameras)
        XCTAssertEqual(router.route(for: .cameras, hasLiveData: store.hasLiveData(for: .cameras)), .native(.cameras))
        let paths = await transport.requests.map { $0.url!.path }
        XCTAssertEqual(paths, ["/trpc/cameras.list"]) // Discovery never downloads hidden snapshots.
        await transport.setFixture("cameras/missing.json", for: "cameras.list")
        await store.refresh(.cameras)
        XCTAssertEqual(router.route(for: .cameras, hasLiveData: store.hasLiveData(for: .cameras)), .webBoard)
        XCTAssertTrue(store.cameras.feeds.isEmpty)
        await transport.setFixture("cameras/list.json", for: "cameras.list")
        await store.refresh(.cameras)
        XCTAssertTrue(store.hasLiveData(for: .cameras))
        let web = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.cameras": "web"]))
        XCTAssertEqual(web.route(for: .cameras, hasLiveData: true), .webBoard)
    }
}
