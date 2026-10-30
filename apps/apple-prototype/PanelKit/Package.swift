// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PanelKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PanelKit", targets: ["PanelKit"])],
    targets: [
        .target(name: "PanelKit"),
        .testTarget(name: "PanelKitTests", dependencies: ["PanelKit"], resources: [.copy("Fixtures")])
    ],
    swiftLanguageModes: [.v6]
)
