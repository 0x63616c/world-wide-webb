import XCTest
@testable import WorldWideWebb

@MainActor final class TeslaProviderTests: XCTestCase {
    func testFixtureAndThreeCommandsPreserveTelemetry() {
        let provider = MockTeslaProvider()
        XCTAssertNil(provider.data.lat); XCTAssertNil(provider.data.lon)
        XCTAssertEqual(provider.data.name, "Model Y"); XCTAssertEqual(provider.data.nick, "Car")
        provider.send(.setLock(false))
        XCTAssertFalse(provider.data.locked)
        provider.send(.setCharging(false))
        XCTAssertFalse(provider.data.charging)
        XCTAssertEqual(provider.data.chargingState, "stopped"); XCTAssertEqual(provider.data.rate, 0)
        provider.send(.setCharging(true))
        XCTAssertTrue(provider.data.charging)
        XCTAssertEqual(provider.data.chargingState, "charging"); XCTAssertEqual(provider.data.rate, 11)
        provider.send(.setPreconditioning(true)); XCTAssertTrue(provider.data.preconditioning)
        provider.send(.setPreconditioning(false)); XCTAssertFalse(provider.data.preconditioning)
        XCTAssertEqual(provider.data.pct, 78); XCTAssertEqual(provider.data.range, 241)
        XCTAssertEqual(provider.data.climate, 64)
    }
    func testUnavailableCommandsDoNotInventState() {
        for availability in [TeslaAvailability.asleep, .offline] {
            let provider = MockTeslaProvider(availability: availability)
            let before = provider.data
            provider.send(.setLock(false)); provider.send(.setCharging(false)); provider.send(.setPreconditioning(true))
            XCTAssertEqual(provider.data, before)
        }
    }
    func testDisconnectedVehicleCannotStartCharge() {
        for state in ["disconnected", "no_power", ""] {
            var data = TeslaData(); data.charging = false; data.chargingState = state; data.rate = 0
            let provider = MockTeslaProvider(data: data)
            provider.send(.setCharging(true))
            XCTAssertEqual(provider.data, data)
        }
    }
}
