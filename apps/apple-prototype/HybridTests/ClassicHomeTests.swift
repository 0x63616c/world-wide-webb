import XCTest
@testable import Panel

final class ClassicHomeTests: XCTestCase {
    @MainActor func testClassicAndHomeClearPendingNativeSelection() {
        let navigation = PanelNavigation()
        navigation.openNativeAlarms()
        navigation.pendingNativeAlarmLink = true
        navigation.openClassic()
        XCTAssertEqual(navigation.selection, .all)
        XCTAssertFalse(navigation.showingHome)
        XCTAssertFalse(navigation.detail)
        XCTAssertFalse(navigation.pendingNativeAlarmLink)
        navigation.returnHome()
        XCTAssertTrue(navigation.showingHome)
    }

    func testClassicAndWebModulesKeepWebRouting() {
        let router = HybridRouter(flags: ModuleFlags(nativeByDefault: [.lights]))
        XCTAssertEqual(router.route(for: .all, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .wifi, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: true), .native(.lights))
    }
}
