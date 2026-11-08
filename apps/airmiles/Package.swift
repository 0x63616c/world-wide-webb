// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AirMilesCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "AirMilesCore", targets: ["AirMilesCore"])],
    targets: [
        .target(name: "AirMilesCore"),
        .testTarget(name: "AirMilesCoreTests", dependencies: ["AirMilesCore"])
    ]
)
