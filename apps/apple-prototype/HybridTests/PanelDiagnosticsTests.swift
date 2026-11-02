import XCTest
import UIKit
@testable import Panel

@MainActor final class PanelDiagnosticsTests: XCTestCase {
    func testGestureAttachesOnlyToRootWindowAndRequiresThreeFingers() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1366, height: 1024))
        let face = UIView()
        window.addSubview(face)
        let attachment = PanelDiagnosticsAccess.AttachmentView(open: {})
        window.addSubview(attachment)
        XCTAssertTrue(attachment.recognizer.view === window)
        XCTAssertEqual(attachment.recognizer.numberOfTouchesRequired, 3)
        XCTAssertEqual(attachment.recognizer.minimumPressDuration, 1.5)
        XCTAssertTrue(face.gestureRecognizers?.isEmpty ?? true)
        attachment.removeFromSuperview()
        XCTAssertNil(attachment.recognizer.view)
    }
    func testInformationalFacesCannotOpenDestinations() {
        for tile in [HomeTile.clock, .weather, .hourly] {
            XCTAssertTrue(PanelHomePresentation.isInformationalFace(tile))
        }
        for tile in [HomeTile.alarm, .climate, .calendar, .sound, .wifi] {
            XCTAssertFalse(PanelHomePresentation.isInformationalFace(tile))
        }
    }
}
