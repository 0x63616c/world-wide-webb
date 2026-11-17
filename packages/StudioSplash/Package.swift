// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "StudioSplash",
  platforms: [.iOS(.v26), .tvOS(.v26), .macOS(.v26)],
  products: [.library(name: "StudioSplash", targets: ["StudioSplash"])],
  targets: [
    // Copy keeps the PNGs byte-for-byte: the sheets are already exact pixel art. The folder
    // is not called Resources: in an iPhone or Apple TV bundle, codesign takes a top-level
    // Resources folder for a Mac bundle layout and rejects the bundle.
    .target(name: "StudioSplash", resources: [.copy("Sheets")]),
    .testTarget(name: "StudioSplashTests", dependencies: ["StudioSplash"]),
  ]
)
