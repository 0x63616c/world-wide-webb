// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RDesign",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RDesign", targets: ["RDesign"]),
        .executable(name: "rframe", targets: ["rframe"])
    ],
    targets: [
        .target(name: "RDesign"),
        .executableTarget(name: "rframe", dependencies: ["RDesign"]),
        .testTarget(name: "RDesignTests", dependencies: ["RDesign"])
    ]
)
