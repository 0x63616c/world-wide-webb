import Foundation
import PanelKit
import XCTest

#if SWIFT_PACKAGE
    @testable import PanelLogic
#else
    @testable import Panel
#endif

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
        XCTAssertEqual(snapshot.hours.count, 12)  // Backend may return up to 24.
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
        continueAfterFailure = false
        XCTAssertEqual(LiveWeatherProvider.pollingInterval, .seconds(600))
        let transport = WeatherProviderTransport()
        let clock = WeatherPollingClock()
        let provider = makeProvider(transport, clock: clock.value)
        defer { provider.stop() }
        provider.startPolling()
        await fulfillment(of: [clock.firstSleep], timeout: 1)
        let initialCount = await transport.count
        XCTAssertEqual(initialCount, 2)
        XCTAssertEqual(clock.delays, [.seconds(600)])

        clock.advance()
        await fulfillment(of: [clock.secondSleep], timeout: 1)
        let refreshedCount = await transport.count
        XCTAssertEqual(refreshedCount, 4)
        XCTAssertEqual(clock.delays, [.seconds(600), .seconds(600)])

        provider.stop()
        await fulfillment(of: [clock.cancelled], timeout: 1)
        clock.advance()
        let stoppedCount = await transport.count
        XCTAssertEqual(stoppedCount, 4)
    }

    func testPresentationMappings() {
        XCTAssertEqual(WeatherPresentation.symbol(icon: "sun"), "sun.max.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "cloud"), "cloud.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "cloud-sun", isDay: false), "cloud.moon.fill")
        XCTAssertEqual(WeatherPresentation.symbol(icon: "future"), "questionmark")
        for code in [
            0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
        ] {
            XCTAssertNotEqual(WeatherPresentation.condition(code: code), "Unknown")
        }
        XCTAssertEqual(WeatherPresentation.condition(code: -1), "Unknown")
    }

    private func makeProvider(_ transport: WeatherProviderTransport, clock: SyncClock = .continuous())
        -> LiveWeatherProvider
    {
        LiveWeatherProvider(
            api: WeatherAPI(
                client: PanelAPIClient(
                    configuration: PanelConfiguration(
                        baseURL: URL(string: "https://weather.example.invalid")!), transport: transport)), clock: clock)
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
        if request.url!.path.hasSuffix("weather/now") {
            data = Data(
                #"{"temp":62.5,"cond":"Partly Cloudy","ic":"cloud-sun","hi":68,"lo":51,"feels":60,"hum":70,"wind":9.5,"uvIndex":3,"precipProbability":20,"sunsetIso":"","sunriseIso":"","tomorrowSunriseIso":"","solarLabel":"Sunset","solarValue":"6:10 PM","city":"Example City"}"#
                    .utf8)
        } else {
            let hours: [[String: Any]] =
                mode == .empty
                ? []
                : (0..<24).map { index in
                    [
                        "t": index == 0 ? "Now" : "1", "temp": 62, "feels": 60,
                        "ic": index == 0 ? "cloud-sun" : "moon", "isDay": index == 0,
                        "isoTime": "2026-10-29T12:00:00.000Z", "weatherCode": 61,
                    ]
                }
            data = try JSONSerialization.data(withJSONObject: hours)
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

/// Polling advances only when the test releases a suspended sleep.
@MainActor private final class WeatherPollingClock {
    let firstSleep = XCTestExpectation(description: "Initial refresh completed")
    let secondSleep = XCTestExpectation(description: "Scheduled refresh completed")
    let cancelled = XCTestExpectation(description: "Polling cancelled")
    private(set) var delays: [Duration] = []
    private var sleeper: CheckedContinuation<Void, any Error>?

    var value: SyncClock {
        SyncClock(
            now: { Date(timeIntervalSince1970: 0) }, elapsed: { .zero },
            sleep: { delay in
                let cancelled = self.cancelled
                try await withTaskCancellationHandler {
                    try Task.checkCancellation()
                    try await withCheckedThrowingContinuation { continuation in
                        self.sleeper = continuation
                        self.delays.append(delay)
                        if self.delays.count == 1 { self.firstSleep.fulfill() }
                        if self.delays.count == 2 { self.secondSleep.fulfill() }
                    }
                } onCancel: {
                    Task { @MainActor in
                        let sleeper = self.sleeper
                        self.sleeper = nil
                        sleeper?.resume(throwing: CancellationError())
                        cancelled.fulfill()
                    }
                }
            })
    }

    func advance() {
        let sleeper = self.sleeper
        self.sleeper = nil
        sleeper?.resume()
    }
}
