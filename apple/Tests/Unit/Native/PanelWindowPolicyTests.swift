import UIKit
import XCTest

@testable import Panel

final class PanelWindowPolicyTests: XCTestCase {
    func testDesktopWindowCanResizeToPhoneWidth() throws {
        XCTAssertEqual(PanelWindowPolicy.minimumSize(isDesktop: true), CGSize(width: 360, height: 480))
        XCTAssertNil(PanelWindowPolicy.minimumSize(isDesktop: false))
    }

    func testHostedAppPreservesPlatformWindowPolicy() throws {
        let info = try XCTUnwrap(Bundle.main.infoDictionary)
        let isPanel = UIDevice.current.userInterfaceIdiom == .pad
        XCTAssertEqual(info["UIRequiresFullScreen"] as? Bool, isPanel)
        let orientations = try XCTUnwrap(info["UISupportedInterfaceOrientations"] as? [String])
        XCTAssertEqual(orientations.contains("UIInterfaceOrientationPortrait"), !isPanel)
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeLeft"))
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeRight"))
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
