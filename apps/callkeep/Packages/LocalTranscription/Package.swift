// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "LocalTranscription",
  platforms: [.macOS(.v15)],
  products: [.library(name: "LocalTranscription", targets: ["LocalTranscription"])],
  dependencies: [
    .package(
      url: "https://github.com/FluidInference/FluidAudio", exact: "0.18.2", traits: ["Diarizer"]),
    .package(url: "https://github.com/argmaxinc/argmax-oss-swift", exact: "1.1.1"),
  ],
  targets: [
    .target(
      name: "LocalTranscription",
      dependencies: [
        .product(name: "FluidAudio", package: "FluidAudio"),
        .product(name: "WhisperKit", package: "argmax-oss-swift"),
      ])
  ],
  swiftLanguageModes: [.v5]
)
