import UIKit
import XCTest

/// Capture the running fixture app's actual simulator screen, including native
/// safe areas, status/navigation bars and system-composited Liquid Glass.
/// A fresh iPhone Duo simulator shows its outer display; nothing here folds it.
@MainActor final class StorefrontCaptureTests: XCTestCase {
  struct Display: Decodable {
    let id: String
    let pixelWidth: Int
    let pixelHeight: Int
    enum CodingKeys: String, CodingKey {
      case id
      case pixelWidth = "pixel_width"
      case pixelHeight = "pixel_height"
    }
  }
  struct Scene: Decodable {
    let id: String
    let appearance: String
    let title: String
    let deviceID: String?
    enum CodingKeys: String, CodingKey {
      case id, appearance, title
      case deviceID = "device_id"
    }
  }

  func testCaptureScreens() throws {
    continueAfterFailure = false
    executionTimeAllowance = 900
    let env = ProcessInfo.processInfo.environment
    let displays = try JSONDecoder().decode(
      [Display].self, from: Data(try XCTUnwrap(env["FOLDING_CAPTURE_DISPLAYS"]).utf8))
    let scenes = try JSONDecoder().decode(
      [Scene].self, from: Data(try XCTUnwrap(env["FOLDING_CAPTURE_SCENES"]).utf8))
    let locale = try XCTUnwrap(env["FOLDING_CAPTURE_LOCALE"])
    let region = try XCTUnwrap(env["FOLDING_CAPTURE_REGION"])
    let first = try XCTUnwrap(scenes.first)
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(\(locale))", "-AppleLocale", "\(locale)_\(region)",
      "--folding-screenshot-locale", locale,
      "--folding-screenshot-scenario", first.id,
      "--folding-screenshot-appearance", first.appearance,
    ]
    var launched = false
    for display in displays {
      if launched {
        // End the previous display's modal scene before waiting on the next
        // full-screen app window. The captured sheets still use native presentation.
        try show(first, in: app)
      }
      if !launched {
        app.launch()
        launched = true
      } else {
        app.activate()
      }
      let expected = CGSize(
        width: CGFloat(display.pixelWidth) / 3, height: CGFloat(display.pixelHeight) / 3)
      let geometry = XCTNSPredicateExpectation(
        predicate: NSPredicate { _, _ in app.windows.firstMatch.frame.size == expected },
        object: nil)
      XCTAssertEqual(
        XCTWaiter.wait(for: [geometry], timeout: 45), .completed,
        "The app must occupy the selected physical simulator display")
      for scene in scenes where scene.deviceID == nil || scene.deviceID == display.id {
        try show(scene, in: app)
        print("STOREFRONT_SCREEN=\(locale)/\(display.id)/\(scene.id)")
        let screens = XCUIScreen.screens.map { $0.screenshot() }
        let matches = screens.filter {
          $0.image.cgImage?.width == display.pixelWidth
            && $0.image.cgImage?.height == display.pixelHeight
        }
        XCTAssertEqual(
          matches.count, 1,
          "Expected \(display.pixelWidth)×\(display.pixelHeight); actual screens: \(screens.map { $0.image.size })"
        )
        let attachment = XCTAttachment(screenshot: try XCTUnwrap(matches.first))
        attachment.name = "storefront-\(locale)-\(display.id)-\(scene.id)"
        attachment.lifetime = .keepAlways
        add(attachment)
      }
    }
    app.terminate()
  }

  private func show(_ scene: Scene, in app: XCUIApplication) throws {
    var url = URLComponents()
    url.scheme = "folding-screenshot"
    url.host = "scene"
    url.queryItems = [
      URLQueryItem(name: "scenario", value: scene.id),
      URLQueryItem(name: "appearance", value: scene.appearance),
    ]
    XCUIDevice.shared.system.open(try XCTUnwrap(url.url))
    guard app.navigationBars[scene.title].waitForExistence(timeout: 15) else {
      let hierarchy = app.debugDescription
      let diagnostic = XCTAttachment(string: hierarchy)
      diagnostic.name = "Native capture readiness hierarchy"
      diagnostic.lifetime = .keepAlways
      add(diagnostic)
      for (index, screen) in XCUIScreen.screens.enumerated() {
        let screenshot = XCTAttachment(screenshot: screen.screenshot())
        screenshot.name = "Native capture readiness screen \(index)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
      }
      XCTFail("Expected visible navigation title \(scene.title) for \(scene.id).\n\(hierarchy)")
      throw NSError(domain: "FoldingCapture", code: 2)
    }
    RunLoop.current.run(until: Date().addingTimeInterval(1.5))
  }
}
