import XCTest
@testable import WorldWideWebb

@MainActor final class TeslaProviderTests: XCTestCase {
    func testFixturePreservesTelemetry() {
        let provider = MockTeslaProvider()
        XCTAssertNil(provider.data.lat); XCTAssertNil(provider.data.lon)
        XCTAssertEqual(provider.data.name, "Model Y"); XCTAssertEqual(provider.data.nick, "Tesla")
        XCTAssertEqual(provider.data.pct, 78); XCTAssertEqual(provider.data.range, 241)
        XCTAssertEqual(provider.data.climate, 64)
    }
}
