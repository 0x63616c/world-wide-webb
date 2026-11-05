import UIKit
import XCTest
@testable import Panel

final class PanelWindowPolicyTests: XCTestCase {
    func testMacHasUsableMinimumWithoutWallPanelDimensions() {
        XCTAssertEqual(PanelWindowPolicy.minimumSize(isiOSAppOnMac: true), CGSize(width: 600, height: 480))
        XCTAssertNil(PanelWindowPolicy.minimumSize(isiOSAppOnMac: false))
    }
    func testPhoneCanRotateAndMultitaskWhileWallIPadStaysLandscape() throws {
        // Bundle.infoDictionary resolves ~ipad overrides on the test device.
        let data = try Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Info.plist"))
        let info = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        XCTAssertEqual(info["UIRequiresFullScreen"] as? Bool, false)
        XCTAssertEqual(info["UIRequiresFullScreen~ipad"] as? Bool, true)
        let orientations = try XCTUnwrap(info["UISupportedInterfaceOrientations"] as? [String])
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationPortrait"))
        XCTAssertEqual(info["UISupportedInterfaceOrientations~ipad"] as? [String],
                       ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"])
    }
}
