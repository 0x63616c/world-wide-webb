// swift-tools-version: 6.2
import PackageDescription

// Host tests for the app logic that compiles without UIKit. The app target itself is built by
// Xcode from apps/ios/project.yml; add a source here only when it builds on macOS as written.
let package = Package(
  name: "FoldingPresentation", platforms: [.macOS(.v15)],
  dependencies: [.package(path: "apps/ios/Packages/FoldingKit")],
  targets: [
    .target(
      name: "FoldingPresentation",
      dependencies: [
        .product(name: "FoldingDomain", package: "FoldingKit"),
        .product(name: "FoldingData", package: "FoldingKit"),
      ], path: "apps/ios/App",
      sources: [
        "AppUpdatePolicy.swift", "CompetitionFailure.swift", "CompetitionPresentation.swift",
        "FoldingPresentation.swift", "MilestoneCache.swift", "MilestoneModels.swift",
        "MilestonePresentation.swift", "NotificationPreferences.swift", "ReviewEligibility.swift",
      ]),
    .testTarget(
      name: "FoldingPresentationTests",
      dependencies: [
        "FoldingPresentation", .product(name: "FoldingDomain", package: "FoldingKit"),
        .product(name: "FoldingData", package: "FoldingKit"),
      ], path: "HostTests"),
  ]
)
