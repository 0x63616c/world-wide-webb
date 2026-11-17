// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "StudioSplash",
  platforms: [.iOS(.v26), .tvOS(.v26), .macOS(.v26)],
  products: [.library(name: "StudioSplash", targets: ["StudioSplash"])],
  targets: [
    // Copy keeps the PNGs byte-for-byte: the sheets are already exact pixel art.
    .target(name: "StudioSplash", resources: [.copy("Resources")]),
    .testTarget(name: "StudioSplashTests", dependencies: ["StudioSplash"]),
  ]
)
