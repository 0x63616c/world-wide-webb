import XCTest
@testable import Panel

final class RemindersRoutingTests: XCTestCase {
    func testRequiresFlagAndLiveData() {
        XCTAssertEqual(ModuleFlags()[.reminders], .web)
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .reminders, hasLiveData: true), .webBoard)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.reminders": "native"]))
        XCTAssertEqual(router.route(for: .reminders, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .reminders, hasLiveData: true), .native(.reminders))
    }
}
