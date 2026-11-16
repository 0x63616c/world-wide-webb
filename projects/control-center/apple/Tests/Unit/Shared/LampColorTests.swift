import XCTest

@testable import Panel

final class LampColorTests: XCTestCase {
    func testPickerPositionsSurviveTheHexRoundTrip() {
        for (hue, saturation) in [(0.0, 1.0), (0.6, 1.0), (0.33, 0.5), (0.985, 0.15), (0.72, 0.62)] {
            let position = LampColor.hueSaturation(hex: LampColor.hex(hue: hue, saturation: saturation))
            XCTAssertEqual(position.hue, hue, accuracy: 0.01)
            XCTAssertEqual(position.saturation, saturation, accuracy: 0.01)
        }
    }

    func testSavedColoursKeepTheirHexAndName() {
        XCTAssertEqual(LampColor.hex(hue: 0, saturation: 1), "#ff0000")
        XCTAssertEqual(LampColor.hex(hue: 2.0 / 3, saturation: 1), "#0000ff")
        XCTAssertEqual(LampColor.name(hex: "#ff0000"), "Red")
        XCTAssertEqual(LampColor.name(hex: "#0066ff"), "Blue")
        XCTAssertEqual(LampColor.name(hex: "#8b5cf6"), "Purple")
        XCTAssertEqual(LampColor.name(hex: "#ffffff"), "White")
    }
}
