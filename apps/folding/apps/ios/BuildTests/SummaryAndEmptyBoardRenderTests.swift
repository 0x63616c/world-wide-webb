import SwiftUI
import UIKit
import XCTest

@testable import Folding

@MainActor final class SummaryAndEmptyBoardRenderTests: XCTestCase {
  func testRenderLargeSharedValueAndEmptyPodium() async throws {
    let card = SummaryCard { MetricRow(title: "All Time folds", value: "97") }
      .frame(width: 190, height: 132)
      .environment(\.colorScheme, .dark)
    let renderer = ImageRenderer(content: card)
    renderer.scale = 3
    let cardImage = try XCTUnwrap(renderer.uiImage)
    try save(cardImage, name: "shared-summary-97")

    let board = LeaderboardPresentation(
      periodTitle: "This Week", entries: [], currentUser: nil, updatedAt: Date())
    let model = FoldingPresentation()
    model.hasLoadedInitialState = true
    model.preferences.appearance = .dark
    model.selectedTab = .leaderboard
    model.competition = .loaded(board)
    model.competitionJoined = true
    let actions = FoldingActions(
      refresh: {}, setup: { _ in throw CocoaError(.userCancelled) },
      savePreferences: { _ in }, loadLeaderboard: { _ in board })
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let old = scene.windows.first { $0.isKeyWindow }
    let window = UIWindow(windowScene: scene)
    let host = UIHostingController(
      rootView: FoldingRootView(model: model, actions: actions).environment(
        \.locale, Locale(identifier: "en")))
    window.overrideUserInterfaceStyle = .dark
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer {
      window.isHidden = true
      old?.makeKeyAndVisible()
    }
    host.view.frame = window.bounds
    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(400))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format).image { _ in
      host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
    }
    try save(image, name: "empty-week-podium")
  }

  private func save(_ image: UIImage, name: String) throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).png")
    try XCTUnwrap(image.pngData()).write(to: url)
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    print("UI_FIXTURE_IMAGE=\(url.path)")
  }
}
