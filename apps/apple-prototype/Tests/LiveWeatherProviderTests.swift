import Foundation
import XCTest
import PanelKit
@testable import WorldWideWebb

@MainActor final class LiveWeatherProviderTests: XCTestCase {
    func testProjectionAndNoImplicitNetworking() async throws {
        let transport = WeatherProviderTransport()
        let provider = makeProvider(transport)
        XCTAssertNil(provider.snapshot)
        XCTAssertEqual(provider.availability, .loading)
        let initialCount = await transport.count
        XCTAssertEqual(initialCount, 0)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        let snapshot = try XCTUnwrap(provider.snapshot)
        XCTAssertEqual(snapshot.city, "Example City")
        XCTAssertEqual(snapshot.temperature, 63)
        XCTAssertEqual(snapshot.high, 68)
        XCTAssertEqual(snapshot.low, 51)
        XCTAssertEqual(snapshot.humidity, 70)
        XCTAssertEqual(snapshot.wind, 10)
        XCTAssertEqual(snapshot.hours.count, 12) // Backend may return up to 24.
        XCTAssertEqual(snapshot.hours[0].symbol, "cloud.sun.fill")
        XCTAssertEqual(snapshot.hours[1].symbol, "moon.fill")
        XCTAssertEqual(snapshot.hours[0].temperature, 62)
        XCTAssertEqual(snapshot.hours[0].feels, 60)
        XCTAssertEqual(snapshot.hourlyConditions[0], "Slight Rain")
        XCTAssertEqual(snapshot.now.uvIndex, 3)
    }

    func testFailurePreservesSnapshotAndRecovers() async {
        let transport = WeatherProviderTransport()
        let provider = makeProvider(transport)
        await provider.refresh()
        await transport.setMode(.failure)
        await provider.refresh()
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        XCTAssertEqual(provider.snapshot?.temperature, 63)
        await transport.setMode(.empty)
        await provider.refresh()
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        await transport.setMode(.success)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
    }

    func testEmptyInitialForecastDoesNotInventWeather() async {
        let transport = WeatherProviderTransport()
        await transport.setMode(.empty)
        let provider = makeProvider(transport)
        await provider.refresh()
        XCTAssertNil(provider.snapshot)
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
    }

    func testPollingStopsAndUsesTenMinuteDefault() async throws {
        XCTAssertEqual(LiveWeatherProvider.pollingInterval, .seconds(600))
        let transport = WeatherProviderTransport()
        let provider = makeProvider(transport)
        defer { provider.stop() }
        provider.startPolling(every: .milliseconds(20))
        for _ in 0..<100 {
            if await transport.count >= 4 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let before = await transport.count
        XCTAssertGreaterThanOrEqual(before, 4)
        provider.stop()
        try await Task.sleep(for: .milliseconds(80))
        let after = await transport.count
        XCTAssertEqual(before, after)
    }

    func testPresentationMappings() {
        XCTAssertEqual(WeatherPresentation.symbol(icon: "sun"), "sun.max.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "cloud"), "cloud.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "cloud-sun", isDay: false), "cloud.moon.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "future"), "questionmark")
        for code in [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99] {
            XCTAssertNotEqual(WeatherPresentation.condition(code: code), "Unknown")
        }
        XCTAssertEqual(WeatherPresentation.condition(code: -1), "Unknown")
    }

    private func makeProvider(_ transport: WeatherProviderTransport) -> LiveWeatherProvider {
        LiveWeatherProvider(api: WeatherAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://weather.example.invalid")!), transport: transport)))
    }
}

private actor WeatherProviderTransport: PanelTransport {
    enum Mode { case success, failure, empty }
    private var mode: Mode = .success
    private(set) var count = 0
    func setMode(_ mode: Mode) { self.mode = mode }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        count += 1
        let data: Data
        if mode == .failure { throw URLError(.notConnectedToInternet) }
        if request.url!.path.hasSuffix("weather.now") {
            data = Data(#"{"result":{"data":{"temp":62.5,"cond":"Partly Cloudy","ic":"cloud-sun","hi":68,"lo":51,"feels":60,"hum":70,"wind":9.5,"uvIndex":3,"precipProbability":20,"sunsetIso":"","sunriseIso":"","tomorrowSunriseIso":"","solarLabel":"Sunset","solarValue":"6:10 PM","city":"Example City"}}}"#.utf8)
        } else {
            let hours: [[String: Any]] = mode == .empty ? [] : (0..<24).map { index in
                ["t": index == 0 ? "Now" : "1", "temp": 62, "feels": 60,
                 "ic": index == 0 ? "cloud-sun" : "moon", "isDay": index == 0,
                 "isoTime": "2026-10-29T12:00:00.000Z", "weatherCode": 61]
            }
            data = try JSONSerialization.data(withJSONObject: ["result": ["data": hours]])
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
