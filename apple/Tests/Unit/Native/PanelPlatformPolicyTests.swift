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

    func testLauncherFitsEverySupportedCanvas() {
        for profile in PanelCanvasProfile.allCases {
            let layout = LauncherLayout(profile: profile)
            let occupied =
                Double(layout.columns) * layout.iconFrameSide
                + Double(max(0, layout.columns - 1)) * 28 + layout.horizontalInset * 2
            XCTAssertLessThanOrEqual(occupied, profile.size.width, "Launcher overflow on \(profile)")
            XCTAssertGreaterThanOrEqual(layout.iconFrameSide, 44)
        }
    }

    func testCanvasSizesMatchThePanelAndDuoDisplays() {
        XCTAssertEqual(PanelCanvasProfile.iPad.size, CGSize(width: 1366, height: 1024))
        XCTAssertEqual(PanelCanvasProfile.duoClosed.size, CGSize(width: 1398 / 3, height: 2034 / 3))
        XCTAssertEqual(PanelCanvasProfile.duoOpen.size, CGSize(width: 2853 / 3, height: 2007 / 3))
        for profile in PanelCanvasProfile.allCases {
            XCTAssertEqual(PanelCanvasProfile.resolve(size: profile.size), profile)
            XCTAssertEqual(
                PanelCanvasProfile.resolve(size: CGSize(width: profile.size.height, height: profile.size.width)),
                profile)
        }
        // An intermediate fold proposal selects a composition, never an
        // intermediate font size or canvas.
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 750, height: 669)), .duoOpen)
        XCTAssertEqual(PanelCanvasProfile.resolve(size: CGSize(width: 500, height: 678)), .duoClosed)
    }
}
