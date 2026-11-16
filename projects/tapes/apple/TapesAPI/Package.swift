// swift-tools-version: 6.0
// The Tapes API client, generated from ../../openapi.json by `scripts/generate-client`.
import PackageDescription

let package = Package(
    name: "TapesAPI",
    platforms: [.iOS(.v18), .tvOS(.v18), .macOS(.v15)],
    products: [.library(name: "TapesAPI", targets: ["TapesAPI"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
    ],
    targets: [
        .target(
            name: "TapesAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ])
    ]
)
