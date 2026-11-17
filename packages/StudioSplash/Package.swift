// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "StudioSplash",
  platforms: [.iOS(.v26), .tvOS(.v26), .macOS(.v26)],
  products: [.library(name: "StudioSplash", targets: ["StudioSplash"])],
  targets: [
    // No resources: the sheets are compiled in (EmbeddedSheets.swift), so apps have no package
    // resource bundle to code sign when they archive.
    .target(name: "StudioSplash"),
    .testTarget(name: "StudioSplashTests", dependencies: ["StudioSplash"]),
  ]
)
