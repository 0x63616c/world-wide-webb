import XCTest
@testable import StillCore

final class TendrLayoutTests: XCTestCase {
    func testMedicationGraphFitsShortWindows() {
        XCTAssertEqual(TendrLayout(horizontal: .regular, vertical: .regular).medicationChartHeight, 300)
        for width: TendrLayout.SizeClass? in [nil, .compact, .regular] {
            XCTAssertEqual(TendrLayout(horizontal: width, vertical: .compact).medicationChartHeight, 180)
        }
    }

    func testGraphFitsShortWindowsAndGrowsWhenUnfolded() {
        let outer = TendrLayout(horizontal: .compact, vertical: .regular)
        let inner = TendrLayout(horizontal: .regular, vertical: .regular)
        XCTAssertNil(outer.maximumContentWidth)
        XCTAssertEqual(outer.weightChartHeight, 220)
        XCTAssertEqual(inner.maximumContentWidth, 760)
        XCTAssertEqual(inner.weightChartHeight, 300)
        let widths: [TendrLayout.SizeClass?] = [nil, .compact, .regular]
        for width in widths {
            XCTAssertEqual(TendrLayout(horizontal: width, vertical: .compact).weightChartHeight, 180)
        }
        XCTAssertEqual(TendrLayout(horizontal: nil, vertical: nil).weightChartHeight, 220)
    }
}
