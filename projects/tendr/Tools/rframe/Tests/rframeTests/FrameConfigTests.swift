import Foundation
import XCTest

@testable import rframe

final class FrameConfigTests: XCTestCase {
  private let duo = #""duo_shots":[{"screen":"home","appearance":"dark"}]"#

  func testFramesKeepOrderAndDefaultToLight() throws {
    let json =
      #"{"shots":[{"screen":"home","eyebrow":"Today","headline":"Your day"},{"screen":"settings","appearance":"dark","eyebrow":"Private","headline":"On your phone"}],"#
      + duo + "}"
    let config = try JSONDecoder().decode(RFrameConfig.self, from: Data(json.utf8))
    XCTAssertEqual(config.shots.map(\.screen), ["home", "settings"])
    XCTAssertEqual(config.shots.map(\.appearance), ["light", "dark"])
    XCTAssertEqual(config.duoShots, [Capture(screen: "home", appearance: "dark")])
  }

  func testRejectsTraversalAndUnsupportedAppearance() {
    for (screen, appearance) in [("../private", "light"), ("home", "sepia"), ("", "dark")] {
      let json =
        "{\"shots\":[{\"screen\":\"\(screen)\",\"appearance\":\"\(appearance)\",\"eyebrow\":\"Today\",\"headline\":\"Your day\"}],"
        + duo + "}"
      XCTAssertThrowsError(try JSONDecoder().decode(RFrameConfig.self, from: Data(json.utf8)))
    }
  }

  func testDuoGalleryHoldsOneToTenCaptures() {
    for count in [0, 11] {
      let shots = Array(repeating: #"{"screen":"home"}"#, count: count).joined(separator: ",")
      let json = #"{"shots":[],"duo_shots":["# + shots + "]}"
      XCTAssertThrowsError(try JSONDecoder().decode(RFrameConfig.self, from: Data(json.utf8)))
    }
  }

  func testReadsSnapshotOutputLayout() {
    let source = Capture(screen: "log-dose", appearance: "dark").source(
      in: URL(fileURLWithPath: "/raw"), device: RFrameConfig.duo)
    XCTAssertEqual(source.path, "/raw/dark/en-US/Screenshots iPhone Duo-log-dose.png")
  }
}
