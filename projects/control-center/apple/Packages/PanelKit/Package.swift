// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PanelKit",
    // macOS hosts developer/CI package tests; it is not an application destination.
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PanelKit", targets: ["PanelKit"])],
    targets: [
        .target(name: "PanelKit", resources: [.process("Sounds")]),
        .testTarget(name: "PanelKitTests", dependencies: ["PanelKit"], resources: [.copy("Fixtures")]),
    ],
    swiftLanguageModes: [.v6]
)
