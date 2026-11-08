import UIKit
import XCTest

@testable import Panel

final class PanelPlatformPolicyTests: XCTestCase {
    func testHostedAppPreservesPlatformWindowPolicy() throws {
        let info = try XCTUnwrap(Bundle.main.infoDictionary)
        let isPanel = UIDevice.current.userInterfaceIdiom == .pad
        // App Store validation requires the unqualified flag for landscape-only iPad support.
        XCTAssertEqual(info["UIRequiresFullScreen"] as? Bool, true)
        let orientations = try XCTUnwrap(info["UISupportedInterfaceOrientations"] as? [String])
        XCTAssertEqual(orientations.contains("UIInterfaceOrientationPortrait"), !isPanel)
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeLeft"))
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeRight"))
    }

    func testOnlyPhoneAndTabletDeviceFamiliesAreShipped() throws {
        let families = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIDeviceFamily") as? [Int])
        XCTAssertEqual(Set(families), [1, 2])
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "LSRequiresIPhoneOS") as? Bool, true)
    }

    func testLauncherFitsCompactAndRegularWindows() {
        for width in [320.0, 360, 390, 600, 700, 900, 1366] {
            let layout = LauncherLayout(width: width, compact: width < 600)
            let occupied =
                Double(layout.columns) * layout.iconFrameSide
                + Double(max(0, layout.columns - 1)) * 28 + layout.horizontalInset * 2
            XCTAssertLessThanOrEqual(occupied, width, "Launcher overflow at \(width)")
            XCTAssertGreaterThanOrEqual(layout.iconFrameSide, 44)
        }
    }
}
