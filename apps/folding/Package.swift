// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "FoldingPresentation", platforms: [.macOS(.v15)],
  dependencies: [.package(path: "apps/ios/Packages/FoldingKit")],
  targets: [
    .target(
      name: "FoldingPresentation",
      dependencies: [.product(name: "FoldingDomain", package: "FoldingKit")], path: "apps/ios/App",
      sources: ["MilestoneModels.swift", "CompetitionFailure.swift", "AppUpdatePolicy.swift"]),
    .testTarget(
      name: "FoldingPresentationTests",
      dependencies: [
        "FoldingPresentation", .product(name: "FoldingDomain", package: "FoldingKit"),
      ], path: "HostTests", sources: ["MilestoneModelTests.swift"]),
  ]
)
