import XCTest
@testable import Panel

final class PanelInputGestureTests: XCTestCase {
    @MainActor func testOnlyFiveFingerInwardPinchReturnsHome() {
        XCTAssertTrue(PanelInputGesture.isHomePinch(touchCount: 5, initial: 200, current: 130))
        XCTAssertFalse(PanelInputGesture.isHomePinch(touchCount: 2, initial: 200, current: 100))
        XCTAssertFalse(PanelInputGesture.isHomePinch(touchCount: 4, initial: 200, current: 100))
        XCTAssertFalse(PanelInputGesture.isHomePinch(touchCount: 5, initial: 200, current: 190))
        XCTAssertFalse(PanelInputGesture.isHomePinch(touchCount: 5, initial: 200, current: 250))
        XCTAssertFalse(PanelInputGesture.isHomePinch(touchCount: 5, initial: 20, current: 10))
    }
}
