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

    func testLauncherFitsResizedWindows() {
        for width: CGFloat in [320, 382, 466, 585, 600, 669, 750, 867, 951, 1024, 1100, 1366] {
            let profile = PanelCanvasProfile.resolve(size: CGSize(width: width, height: 900))
            let layout = LauncherLayout(profile: profile, availableWidth: width)
            let occupied =
                CGFloat(layout.columns) * max(layout.iconFrameSide, layout.labelSize * 6)
                + CGFloat(max(0, layout.columns - 1)) * layout.columnSpacing + layout.horizontalInset * 2
            XCTAssertLessThanOrEqual(occupied, width, "Launcher overflow at width \(width)")
            XCTAssertGreaterThanOrEqual(layout.iconFrameSide, 44)
        }
    }

    func testPresentationUsesAvailableWidthInsteadOfDeviceDimensions() {
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 466, height: 1200)), .compact)
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 750, height: 669)), .regular)
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 1366, height: 1024)), .spacious)
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 500, height: 678)), .compact)
    }
}
