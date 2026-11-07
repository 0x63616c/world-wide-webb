// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "FoldingKit",
  platforms: [.iOS("27.0"), .macOS(.v15)],
  products: [.library(name: "FoldingDomain", targets: ["FoldingDomain"])],
  targets: [
    .target(name: "FoldingDomain"),
    .testTarget(name: "FoldingDomainTests", dependencies: ["FoldingDomain"]),
  ]
)
