// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "StillCore", platforms: [.macOS(.v14)], products: [.library(name: "StillCore", targets: ["StillCore"])], targets: [.target(name: "StillCore", path: "Still/Core"), .testTarget(name: "StillCoreTests", dependencies: ["StillCore"], path: "Tests")])
