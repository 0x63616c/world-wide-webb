// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "FoldingKit",
  platforms: [.iOS("27.0"), .macOS(.v15)],
  products: [
    .library(name: "FoldingDomain", targets: ["FoldingDomain"]),
    .library(name: "FoldingData", targets: ["FoldingData"]),
    .executable(name: "FoldingJournalProbe", targets: ["FoldingJournalProbe"]),
  ],
  targets: [
    .target(name: "FoldingDomain"),
    .target(
      name: "FoldingData", dependencies: ["FoldingDomain"],
      linkerSettings: [.linkedLibrary("sqlite3")]),
    .executableTarget(name: "FoldingJournalProbe", dependencies: ["FoldingData", "FoldingDomain"]),
    .testTarget(
      name: "FoldingDataTests",
      dependencies: ["FoldingData", "FoldingDomain", "FoldingJournalProbe"]),
    .testTarget(name: "FoldingDomainTests", dependencies: ["FoldingDomain"]),
  ]
)
