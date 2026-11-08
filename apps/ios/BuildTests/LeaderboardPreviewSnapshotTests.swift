import FoldingDomain
import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import XCTest

@testable import Folding

/// Direct rendering of production views with isolated fictional data; no UI automation or live account.
@MainActor final class LeaderboardPreviewSnapshotTests: XCTestCase {
  func testRenderLeaderboardPreview() async throws {
    let fixture = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "ProfilePortraits", withExtension: "png"))
    let atlas = try XCTUnwrap(UIImage(contentsOfFile: fixture.path)?.cgImage)
    let side = atlas.width / 3
    let names = ["Alex", "Taylor", "Morgan", "Sam", "Jamie", "Casey", "Jordan", "Riley", "Robin"]
    let scores = [184, 156, 132, 118, 96, 82, 70, 58, 46]
    let entries = try names.enumerated().map { index, name in
      let image = try XCTUnwrap(
        atlas.cropping(
          to: CGRect(
            x: (index % 3) * side, y: (index / 3) * side, width: side, height: side)))
      return LeaderboardEntry(
        id: "preview-\(index)", rank: index + 1, displayName: name, folds: scores[index],
        approvedAvatarURL: nil, isCurrentUser: index == 3,
        approvedAvatarData: UIImage(cgImage: image).pngData())
    }
    let board = LeaderboardPresentation(
      periodTitle: "This Week", entries: entries, currentUser: entries[3], pendingFolds: 0,
      updatedAt: Date(timeIntervalSince1970: 1_794_153_600), population: 124)
    let model = FoldingPresentation()
    model.hasLoadedInitialState = true
    model.preferences.appearance = .dark
    model.selectedTab = .leaderboard
    model.competition = .loaded(board)
    model.competitionJoined = true
    model.competitionProfile = CompetitionProfile(
      id: entries[3].id, nickname: names[3], approvedAvatarURL: nil,
      avatarState: .approved, approvedAvatarData: entries[3].approvedAvatarData)
    let actions = FoldingActions(
      refresh: {}, setup: { _ in throw CocoaError(.userCancelled) },
      savePreferences: { _ in }, loadLeaderboard: { _ in board })
    let root = FoldingRootView(model: model, actions: actions)
      .environment(\.locale, Locale(identifier: "en"))
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let oldWindow = scene.windows.first { $0.isKeyWindow }
    let window = UIWindow(windowScene: scene)
    window.overrideUserInterfaceStyle = .dark
    let host = UIHostingController(rootView: root)
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer {
      window.isHidden = true
      oldWindow?.makeKeyAndVisible()
    }
    print("LEADERBOARD_PREVIEW_SCENE=\(scene.coordinateSpace.bounds) WINDOW=\(window.bounds)")
    for (name, size) in [("preview", scene.coordinateSpace.bounds.size)] {
      window.frame = CGRect(origin: .zero, size: size)
      host.view.frame = window.bounds
      host.view.setNeedsLayout()
      host.view.layoutIfNeeded()
      try await Task.sleep(for: .milliseconds(700))
      let format = UIGraphicsImageRendererFormat()
      format.scale = 3
      format.opaque = true
      let renderer = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format)
      let image = renderer.image { _ in
        host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
      }
      let output = FileManager.default.temporaryDirectory.appendingPathComponent(
        "folding-leaderboard-\(name).png")
      try XCTUnwrap(image.pngData()).write(to: output)
      let attachment = XCTAttachment(image: image)
      attachment.name = "Leaderboard \(name)"
      attachment.lifetime = .keepAlways
      add(attachment)
      print("LEADERBOARD_PREVIEW_IMAGE=\(output.path)")
      let animationURL = FileManager.default.temporaryDirectory.appendingPathComponent(
        "folding-leaderboard-animated.gif")
      let destination = try XCTUnwrap(
        CGImageDestinationCreateWithURL(
          animationURL as CFURL, UTType.gif.identifier as CFString, 48, nil))
      CGImageDestinationSetProperties(
        destination,
        [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
      let animationFormat = UIGraphicsImageRendererFormat()
      animationFormat.scale = 1.5
      animationFormat.opaque = true
      let animationRenderer = UIGraphicsImageRenderer(
        size: host.view.bounds.size, format: animationFormat)
      for _ in 0..<48 {
        try await Task.sleep(for: .milliseconds(83))
        let frame = animationRenderer.image { _ in
          host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        CGImageDestinationAddImage(
          destination, try XCTUnwrap(frame.cgImage),
          [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.083]] as CFDictionary)
      }
      XCTAssertTrue(CGImageDestinationFinalize(destination))
      print("LEADERBOARD_PREVIEW_ANIMATION=\(animationURL.path)")

    }
  }
}
