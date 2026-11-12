import UIKit
import XCTest

/// Capture the running fixture app's actual simulator screen, including native
/// safe areas, status/navigation bars and system-composited Liquid Glass.
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
    let deviceID: String?
    enum CodingKeys: String, CodingKey {
      case id, appearance
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
      if display.id.hasPrefix("duo-") {
        try selectPose(display.id == "duo-inner" ? "inner" : "outer", environment: env)
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
        var url = URLComponents()
        url.scheme = "folding-screenshot"
        url.host = "scene"
        url.queryItems = [
          URLQueryItem(name: "scenario", value: scene.id),
          URLQueryItem(name: "appearance", value: scene.appearance),
        ]
        XCUIDevice.shared.system.open(try XCTUnwrap(url.url))
        XCTAssertTrue(
          app.windows["folding.screenshot.\(scene.id).\(scene.appearance)"].waitForExistence(
            timeout: 15),
          "The running app must acknowledge the configured scene")
        // Allow native sheet and appearance transitions to finish, as in Tendr's capture.
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        print("STOREFRONT_SCREEN=\(locale)/\(display.id)/\(scene.id)")
        let matches = XCUIScreen.screens.map { $0.screenshot() }.filter {
          $0.image.cgImage?.width == display.pixelWidth
            && $0.image.cgImage?.height == display.pixelHeight
        }
        XCTAssertEqual(
          matches.count, 1, "Exactly one native screen must match the selected display")
        let attachment = XCTAttachment(screenshot: try XCTUnwrap(matches.first))
        attachment.name = "storefront-\(locale)-\(display.id)-\(scene.id)"
        attachment.lifetime = .keepAlways
        add(attachment)
      }
    }
    app.terminate()
  }

  private func selectPose(_ pose: String, environment: [String: String]) throws {
    let directory = URL(fileURLWithPath: try XCTUnwrap(environment["DUO_HOST_CONTROL_DIR"]))
    let id = UUID().uuidString
    let request = try JSONSerialization.data(withJSONObject: ["id": id, "pose": pose])
    try request.write(to: directory.appendingPathComponent("host-request.json"), options: .atomic)
    let deadline = Date().addingTimeInterval(60)
    while Date() < deadline {
      if let data = try? Data(contentsOf: directory.appendingPathComponent("host-response.json")),
        let response = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        response["id"] as? String == id, response["ok"] as? Bool == true
      {
        return
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    XCTFail("Native Device Hub pose \(pose) was not acknowledged")
    throw NSError(domain: "FoldingCapture", code: 1)
  }
}
