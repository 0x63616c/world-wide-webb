import Foundation
import XCTest
@testable import RDesign

final class FrameConfigTests: XCTestCase {
    func testFramesKeepOrderAndDefaultToLight() throws {
        let json = #"{"shots":[{"screen":"home","eyebrow":"Today","headline":"Your day"},{"screen":"settings","appearance":"dark","eyebrow":"Private","headline":"On your phone"}]}"#
        let config = try JSONDecoder().decode(RFrameConfig.self, from: Data(json.utf8))
        XCTAssertEqual(config.shots.map(\.screen), ["home", "settings"])
        XCTAssertEqual(config.shots.map(\.appearance), ["light", "dark"])
    }

    func testRejectsTraversalAndUnsupportedAppearance() {
        for (screen, appearance) in [("../private", "light"), ("home", "sepia"), ("", "dark")] {
            let json = "{\"shots\":[{\"screen\":\"\(screen)\",\"appearance\":\"\(appearance)\",\"eyebrow\":\"Today\",\"headline\":\"Your day\"}]}"
            XCTAssertThrowsError(try JSONDecoder().decode(RFrameConfig.self, from: Data(json.utf8)))
        }
    }
}
