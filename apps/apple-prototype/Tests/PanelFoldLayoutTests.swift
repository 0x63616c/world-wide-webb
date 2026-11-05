import XCTest
@testable import WorldWideWebb

final class PanelFoldLayoutTests: XCTestCase {
    func testVerticalDivisionKeepsControlsOnOneSide() {
        let bounds = CGRect(x: 0, y: 0, width: 900, height: 600)
        let fold = CGRect(x: 400, y: 0, width: 40, height: 600)
        let frame = PanelFoldLayout.usableFrame(in: bounds, avoiding: [fold])
        XCTAssertEqual(frame, CGRect(x: 440, y: 0, width: 460, height: 600))
        XCTAssertFalse(frame.intersects(fold.insetBy(dx: 1, dy: 1)))
    }
    func testTabletopUsesLargerClearRegionAndIgnoresOutsideDivisions() {
        let bounds = CGRect(x: 0, y: 0, width: 600, height: 800)
        XCTAssertEqual(PanelFoldLayout.usableFrame(in: bounds, avoiding: [CGRect(x: 0, y: 300, width: 600, height: 40)]),
                       CGRect(x: 0, y: 340, width: 600, height: 460))
        XCTAssertEqual(PanelFoldLayout.usableFrame(in: bounds, avoiding: [CGRect(x: 900, y: 0, width: 40, height: 800)]), bounds)
    }
}
