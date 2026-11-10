// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PanelLogic", platforms: [.macOS(.v14)],
    products: [.library(name: "PanelLogic", targets: ["PanelLogic"])],
    dependencies: [.package(path: "Packages/PanelKit")],
    targets: [
        .target(
            name: "PanelLogic", dependencies: ["PanelKit"], path: "App",
            sources: [
                "HomeModels.swift", "WifiQRCode.swift", "Live/LiveAvailability.swift", "Live/LiveClimateProvider.swift",
                "Live/LiveFanProvider.swift", "Live/LiveLightsProvider.swift", "Live/LiveSonosProvider.swift",
                "Live/LiveWeatherProvider.swift", "Live/LiveWifiProvider.swift",
            ]),
        .testTarget(
            name: "PanelLogicTests", dependencies: ["PanelLogic", "PanelKit"], path: "Tests/Unit/Shared",
            sources: [
                "LiveClimateProviderTests.swift", "LiveFanProviderTests.swift", "LiveLightsProviderTests.swift",
                "LiveSonosProviderTests.swift", "LiveWeatherProviderTests.swift", "LiveWifiProviderTests.swift",
            ]),
    ]
)
