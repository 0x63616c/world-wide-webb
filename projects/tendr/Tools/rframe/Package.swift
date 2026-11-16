// swift-tools-version: 6.0
import PackageDescription

// Tool only: frames raw simulator captures for the App Store. The app does not depend on it.
let package = Package(
  name: "rframe",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "rframe"),
    .testTarget(name: "rframeTests", dependencies: ["rframe"]),
  ]
)
