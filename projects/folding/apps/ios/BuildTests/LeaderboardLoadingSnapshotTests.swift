import SwiftUI
import UIKit
import XCTest

@testable import Folding

@MainActor final class LeaderboardLoadingSnapshotTests: XCTestCase {
  func testLoadingScreenshot() async throws {
    let model = FoldingPresentation()
    model.hasLoadedInitialState = true
    model.selectedTab = .leaderboard
    model.competitionPeriod = .month
    model.competition = .loading(nil)
    var actions = FoldingActions(
      refresh: {}, setup: { _ in throw CancellationError() }, savePreferences: { _ in })
    actions.loadLeaderboard = { _ in
      try await Task.sleep(for: .seconds(60))
      throw CancellationError()
    }
    let controller = UIHostingController(
      rootView: NavigationStack {
        LeaderboardScreen(model: model, actions: actions)
          .navigationTitle("Leaderboard")
      }
      .preferredColorScheme(.light))
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    controller.view.frame = window.bounds
    controller.view.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(650))
    controller.view.layoutIfNeeded()
    let image = UIGraphicsImageRenderer(bounds: controller.view.bounds).image { context in
      controller.view.layer.render(in: context.cgContext)
    }
    let attachment = XCTAttachment(image: image)
    attachment.name = "Leaderboard loading"
    attachment.lifetime = .keepAlways
    add(attachment)
    let output = FileManager.default.temporaryDirectory.appendingPathComponent(
      "leaderboard-loading.png")
    try XCTUnwrap(image.pngData()).write(to: output)
    print("LOADING_SCREENSHOT_PATH=\(output.path)")
    XCTAssertNil(model.competition.previous)
  }
}
