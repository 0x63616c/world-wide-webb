import Foundation
import XCTest
import PanelKit
@testable import Panel

@MainActor final class TeslaRoutingTests: XCTestCase {
    func testTeslaRemainsWebByDefaultAndMissingBackendFallsBack() async throws {
        XCTAssertFalse(ModuleFlags.shippedNative.contains(.tesla))
        XCTAssertEqual(ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)[.tesla], .web)
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        let store = LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://fixtures.example.invalid")!), transport: transport)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.tesla": "native"]))
        XCTAssertEqual(router.route(for: .tesla, hasLiveData: store.hasLiveData(for: .tesla)), .webBoard)
        await store.refresh(.tesla)
        XCTAssertEqual(router.route(for: .tesla, hasLiveData: store.hasLiveData(for: .tesla)), .native(.tesla))
        XCTAssertEqual(store.tesla.data.pct, 72)
        for failure in ["unconfigured", "unavailable", "absent"] {
            await transport.setFixture("tesla/\(failure).json", for: "tesla.state")
            await store.refresh(.tesla)
            XCTAssertEqual(router.route(for: .tesla, hasLiveData: store.hasLiveData(for: .tesla)), .webBoard)
        }
        await transport.setFixture("tesla/ready.json", for: "tesla.state")
        await store.refresh(.tesla)
        XCTAssertTrue(store.hasLiveData(for: .tesla))
        store.stop()
        XCTAssertFalse(store.hasLiveData(for: .tesla))
    }
}
