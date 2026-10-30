import UIKit
import XCTest
@testable import Panel

final class PanelWindowPolicyTests: XCTestCase {
    func testMacUsesLandscapeWallPointSize() throws {
        let size = try XCTUnwrap(PanelWindowPolicy.fixedSize(isiOSAppOnMac: true))
        XCTAssertEqual(size, CGSize(width: 1366, height: 1024))
        XCTAssertGreaterThan(size.width, size.height)
    }

    func testWallIPadAndPhoneDoNotReceiveMacRestrictions() {
        XCTAssertNil(PanelWindowPolicy.fixedSize(isiOSAppOnMac: false))
    }

    func testHostedAppRequiresFullScreenAndLandscapeOnly() throws {
        let info = try XCTUnwrap(Bundle.main.infoDictionary)
        XCTAssertEqual(info["UIRequiresFullScreen"] as? Bool, true)
        let orientations = try XCTUnwrap(info["UISupportedInterfaceOrientations"] as? [String])
        XCTAssertEqual(orientations.sorted(), ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"])
        XCTAssertNil(info["UISupportedInterfaceOrientations~ipad"])
    }
}
