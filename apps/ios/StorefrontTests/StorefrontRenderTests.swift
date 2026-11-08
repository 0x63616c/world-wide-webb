import SwiftUI
import UIKit
import XCTest

@testable import FoldingScreenshots

/// Store assets render the production views directly with isolated fixed-clock data.
/// The runtime only executes UIKit/XCTest; no simulator UI navigation or live clients.
@MainActor final class StorefrontRenderTests: XCTestCase {
  struct Plan: Decodable {
    let scenarios: [Scene]
    let devices: [Display]
    let reviewScenarios: [ReviewScene]
    enum CodingKeys: String, CodingKey {
      case scenarios, devices
      case reviewScenarios = "review_scenarios"
    }
  }
  struct Scene: Decodable {
    let id: String
    let appearance: String
  }
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
  struct ReviewScene: Decodable {
    let id: String
    let appLocale: String
    let deviceID: String
    enum CodingKeys: String, CodingKey {
      case id
      case appLocale = "app_locale"
      case deviceID = "device_id"
    }
  }

  func testRenderStorefront() async throws {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "screenshot-plan", withExtension: "json"))
    let plan = try JSONDecoder().decode(Plan.self, from: Data(contentsOf: url))
    let preferred = try XCTUnwrap(Bundle.main.preferredLocalizations.first)
    let locale = preferred == "en-US" ? "en" : preferred
    XCTAssertTrue(
      ["en", "de", "fr", "es", "es-419", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"].contains(locale)
    )
    print("STOREFRONT_APP_LOCALE=\(locale)")
    for display in plan.devices {
      for scene in plan.scenarios {
        let fixture = try ScreenshotFixture(arguments: [
          "--folding-screenshot-scenario", scene.id, "--folding-screenshot-locale", locale,
          "--folding-screenshot-appearance", scene.appearance,
        ])
        try await render(
          fixture: fixture, scene: scene.id, display: display, locale: locale,
          appearance: scene.appearance)
      }

    }
  }

  func testRenderTipReview() async throws {
    let fixture = try ScreenshotFixture(arguments: ["--folding-screenshot-scenario", "tipjar"])
    try await render(
      fixture: fixture, scene: "tipjar",
      display: Display(id: "duo-outer", pixelWidth: 1398, pixelHeight: 2034),
      locale: "en", appearance: "light")
  }

  private func render(
    fixture: ScreenshotFixture, scene: String, display: Display, locale: String, appearance: String
  ) async throws {
    let windowScene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let previousWindow = windowScene.windows.first { $0.isKeyWindow }
    let window = UIWindow(windowScene: windowScene)
    let scale: CGFloat = 3
    let size = CGSize(
      width: CGFloat(display.pixelWidth) / scale, height: CGFloat(display.pixelHeight) / scale)
    let content: AnyView
    switch scene {
    case "milestones":
      content = AnyView(
        NavigationStack { MilestonesScreen(model: fixture.model, actions: fixture.actions) })
    case "patterns":
      content = AnyView(
        NavigationStack { PatternsScreen(model: fixture.model, actions: fixture.actions) })
    case "tipjar":
      content = AnyView(
        NavigationStack {
          TipJarContent(
            rows: fixture.tipRows, loading: false, purchasing: nil, message: nil, retry: {},
            purchase: { _ in })
        })
    default: content = AnyView(FoldingRootView(model: fixture.model, actions: fixture.actions))
    }
    // Sheet contents above are the real production views, hosted directly so the
    // capture geometry never inherits another physical display's sheet/window size.
    fixture.model.sheet = nil
    let host = UIHostingController(
      rootView:
        content
        .environment(\.locale, Locale(identifier: locale))
        .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        .environment(\.scenePhase, .active)
        .preferredColorScheme(appearance == "dark" ? .dark : .light)
        .fontDesign(.rounded).tint(FoldingTint.color)
        .frame(width: size.width, height: size.height))
    host.safeAreaRegions = []
    host.overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light
    let parent = UIViewController()
    window.rootViewController = parent
    parent.addChild(host)
    parent.view.addSubview(host.view)
    host.didMove(toParent: parent)
    parent.setOverrideTraitCollection(
      UITraitCollection(horizontalSizeClass: size.width < 600 ? .compact : .regular), forChild: host
    )
    window.makeKeyAndVisible()
    defer {
      host.willMove(toParent: nil)
      host.view.removeFromSuperview()
      host.removeFromParent()
      window.isHidden = true
      window.rootViewController = nil
      previousWindow?.makeKeyAndVisible()
    }
    host.view.autoresizingMask = []
    host.view.frame = CGRect(origin: .zero, size: size)
    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(500))
    host.view.layoutIfNeeded()
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
    }
    XCTAssertEqual(image.cgImage?.width, display.pixelWidth)
    XCTAssertEqual(image.cgImage?.height, display.pixelHeight)
    let attachment = XCTAttachment(image: image)
    attachment.name = "storefront-\(locale)-\(display.id)-\(scene)"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
