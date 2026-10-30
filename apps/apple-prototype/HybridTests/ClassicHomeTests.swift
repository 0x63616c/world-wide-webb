import XCTest
@testable import Panel

final class ClassicHomeTests: XCTestCase {
    func testClassicIsLastAndEachModuleAppearsOnce() {
        XCTAssertEqual(PanelModule.homeTiles.last, .all)
        XCTAssertEqual(Set(PanelModule.homeTiles), Set(PanelModule.allCases))
        XCTAssertEqual(PanelModule.homeTiles.count, PanelModule.allCases.count)
        XCTAssertEqual(PanelModule.all.homeSymbol, "safari")
    }

    func testClassicAndWebModulesKeepWebRouting() {
        let router = HybridRouter(flags: ModuleFlags(nativeByDefault: [.lights]))
        XCTAssertEqual(router.route(for: .all, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .wifi, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: true), .native(.lights))
    }
}
