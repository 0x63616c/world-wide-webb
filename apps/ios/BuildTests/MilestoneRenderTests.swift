import FoldingDomain
import SwiftUI
import UIKit
import XCTest

@testable import Folding

/// Direct snapshots of the production views. No simulator UI navigation or
/// replacement screenshot screen is involved.
@MainActor final class MilestoneRenderTests: XCTestCase {
  func testRenderProductionMilestoneStates() async throws {
    let model = FoldingPresentation()
    model.competitionJoined = true
    model.competitionProfile = CompetitionProfile(
      id: "00000000-0000-4000-8000-000000000001", nickname: "Ari",
      approvedAvatarURL: nil, avatarState: .none)
    let fixtureURL = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "milestones", withExtension: "json"))
    let data = try Data(contentsOf: fixtureURL)
    let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let owner = try JSONDecoder().decode(
      OwnerMilestones.self, from: JSONSerialization.data(withJSONObject: fixture["owner"]!))
    let publicProfile = try JSONDecoder().decode(
      ParticipantProfileResponse.self,
      from: JSONSerialization.data(withJSONObject: fixture["public_profile"]!))
    model.ownerMilestones = owner
    var actions = FoldingActions(
      refresh: {}, setup: { _ in throw CancellationError() }, savePreferences: { _ in })
    actions.loadOwnerMilestones = { MilestoneOwnerLoad(snapshot: owner, confirmed: true) }
    actions.loadParticipantProfile = { _ in
      ParticipantProfileLoad(profile: publicProfile, avatarData: nil)
    }
    actions.featureMilestone = { _, _, _ in owner }

    try await render(
      YourProfileScreen(model: model, actions: actions), name: "profile-narrow-light", width: 390,
      height: 900)
    try await render(
      MilestonesScreen(model: model, actions: actions), name: "milestones-next-1000", width: 390,
      height: 900)
    try await render(
      MilestoneBadgeDetail(badge: .folds100, owner: true, model: model, actions: actions),
      name: "badge-detail-dark", width: 390, height: 900, dark: true)
    try await render(
      ParticipantProfileScreen(
        participantID: publicProfile.profile.participantID, model: model, actions: actions),
      name: "public-profile", width: 390, height: 900)

    let complete = OwnerMilestones(
      generation: owner.generation, revision: 9,
      progress: MilestoneProgress(
        catalogVersion: 1, folds: 10_000, daysUsed: 30, next: [], earned: MilestoneBadge.allCases),
      grants: MilestoneBadge.allCases.map {
        EarnedMilestone(badgeID: $0, earnedAtMS: 1_794_000_000_000, acknowledged: true)
      },
      featuredBadgeID: .days30)
    model.ownerMilestones = complete
    actions.loadOwnerMilestones = { MilestoneOwnerLoad(snapshot: complete, confirmed: true) }
    try await render(
      MilestonesScreen(model: model, actions: actions), name: "milestones-complete-wide-dark",
      width: 760, height: 1030, dark: true)
    try await render(
      MilestonesScreen(model: model, actions: actions), name: "milestones-accessibility",
      width: 390, height: 1500, typeSize: .accessibility1)

    let assets = VStack(spacing: 24) {
      HStack(spacing: 16) {
        ForEach(Array(MilestoneBadge.allCases.prefix(4))) {
          MilestoneBadgeArtwork(badge: $0, size: 96)
        }
      }
      HStack(spacing: 16) {
        ForEach(Array(MilestoneBadge.allCases.suffix(2))) {
          MilestoneBadgeArtwork(badge: $0, size: 96)
        }
      }
    }.padding()
    try await render(assets, name: "six-badge-artworks", width: 760, height: 500)
  }

  private func render<V: View>(
    _ screen: V, name: String, width: CGFloat, height: CGFloat, dark: Bool = false,
    typeSize: DynamicTypeSize = .large
  ) async throws {
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    // Native navigation bars use window geometry as well as view bounds. Give
    // the wide fixture a landscape window before sizing the offscreen child.
    scene.requestGeometryUpdate(
      .iOS(interfaceOrientations: width >= 600 ? .landscapeRight : .portrait))
    try await Task.sleep(for: .milliseconds(200))
    let window = UIWindow(windowScene: scene)
    window.frame = scene.coordinateSpace.bounds
    let root = NavigationStack { screen }
      .environment(\.locale, Locale(identifier: "en"))
      .environment(\.scenePhase, .active)
      .environment(\.dynamicTypeSize, typeSize)
      .preferredColorScheme(dark ? .dark : .light)
      .tint(FoldingTint.color)
      .fontDesign(.rounded)
      .frame(width: width, height: height)
    let host = UIHostingController(rootView: root)
    // Offscreen fixture canvases must not inherit the physical window's cutout
    // insets, which otherwise shift a wide canvas outside its measured bounds.
    host.safeAreaRegions = []
    host.overrideUserInterfaceStyle = dark ? .dark : .light
    let parent = UIViewController()
    window.rootViewController = parent
    parent.addChild(host)
    parent.view.addSubview(host.view)
    host.didMove(toParent: parent)
    parent.setOverrideTraitCollection(
      UITraitCollection(horizontalSizeClass: width < 600 ? .compact : .regular), forChild: host)
    window.isHidden = false
    defer {
      host.willMove(toParent: nil)
      host.view.removeFromSuperview()
      host.removeFromParent()
      window.isHidden = true
      window.rootViewController = nil
    }
    host.view.autoresizingMask = []
    host.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(300))
    host.view.layoutIfNeeded()
    XCTAssertEqual(host.view.bounds.size, CGSize(width: width, height: height))
    let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height)).image { _ in
      host.view.drawHierarchy(
        in: CGRect(x: 0, y: 0, width: width, height: height), afterScreenUpdates: true)
    }
    XCTAssertEqual(image.size.width, width)
    XCTAssertEqual(image.size.height, height)
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
