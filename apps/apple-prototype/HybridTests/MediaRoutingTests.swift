import PanelKit
import XCTest
@testable import Panel

@MainActor final class MediaRoutingTests: XCTestCase {
    func testMediaRemainsWebByDefaultAndRequiresLiveData() {
        XCTAssertEqual(ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)[.media], .web)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.media": "native"]))
        XCTAssertEqual(router.route(for: .media, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .media, hasLiveData: true), .native(.media))
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .media, hasLiveData: true), .webBoard)
        let rollback = ModuleFlags(overrides: ["moduleFlag.media": "native"], webOnly: true)
        XCTAssertEqual(rollback[.media], .web)
    }

    func testAbsentSourceStaysOnWebWithoutMockData() async {
        let store = LiveHomeDataSource(configuration: nil)
        await store.refresh(.media)
        XCTAssertFalse(store.hasLiveData(for: .media))
        XCTAssertTrue(store.media.items.isEmpty)
        XCTAssertNil(store.media.videoURL)
    }

    func testInjectedDataEnablesNativeAndStopRevokesIt() async {
        let store = LiveHomeDataSource(configuration: .init(baseURL: URL(string: "http://localhost:18733")!),
                                      mediaAPI: HybridMediaFixture(unavailable: false))
        await store.refresh(.media)
        XCTAssertTrue(store.hasLiveData(for: .media))
        XCTAssertEqual(store.media.items.map(\.id), ["synthetic_video"])
        store.stop()
        XCTAssertFalse(store.hasLiveData(for: .media))
        XCTAssertNil(store.media.videoURL)
    }
}
