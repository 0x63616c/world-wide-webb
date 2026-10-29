import XCTest
@testable import WorldWideWebb

@MainActor final class HomeDataSourceTests: XCTestCase {
    func testAllUsesANDAndMastersUseOR() async {
        let store = MockHomeDataSource(latency: .zero)
        XCTAssertFalse(store.lamps.isOn(.all))
        XCTAssertTrue(store.lamps.isOn(.lamps))
        XCTAssertTrue(store.lamps.isOn(.lights))
        store.send(.toggle(.all))
        XCTAssertTrue(store.lamps.on.allSatisfy { $0 })
        XCTAssertTrue(store.lamps.ceiling && store.lamps.cabinet)
        XCTAssertTrue(store.lamps.isOn(.all))
        store.send(.toggle(.ceiling))
        XCTAssertFalse(store.lamps.isOn(.all))
        XCTAssertTrue(store.lamps.isOn(.lights))
        store.send(.toggle(.all))
        store.send(.toggle(.all))
        XCTAssertFalse(store.lamps.anyOn)
        XCTAssertFalse(store.lamps.isOn(.lights))
    }
    func testRoomMembershipIncludesKitchenInLivingRoom() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.toggle(.lamps))
        store.send(.toggle(.livingRoom))
        XCTAssertEqual(Array(store.lamps.on[0..<3]), [false, false, false])
        XCTAssertEqual(Array(store.lamps.on[3..<8]), Array(repeating: true, count: 5))
        XCTAssertEqual(LampState.names.last, "Kitchen Lamp")
    }
    func testFanOffWhenClimateOffAndAllDoesNotChangeFan() async {
        let store = MockHomeDataSource(latency: .zero)
        XCTAssertEqual(store.climate.fanLabel, "Auto")
        store.send(.toggle(.fan))
        XCTAssertEqual(store.climate.fanLabel, "On")
        store.send(.toggle(.all))
        XCTAssertTrue(store.climate.fanOn)
        store.send(.mode(.off))
        XCTAssertEqual(store.climate.fanLabel, "Off")
        store.send(.mode(.cool))
        XCTAssertEqual(store.climate.fanLabel, "On")
    }
    func testLampDependentControlsDisabledWhenOffAndClampedWhenOn() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.toggle(.lamps))
        store.send(.brightness(90)); store.send(.party(.fast)); store.send(.kelvin(6500))
        XCTAssertEqual(store.lamps.brightness, 65)
        XCTAssertEqual(store.lamps.party, .off)
        XCTAssertEqual(store.lamps.kelvin, 2700)
        store.send(.toggle(.lamps))
        store.send(.brightness(150)); XCTAssertEqual(store.lamps.brightness, 100)
        store.send(.brightness(-1)); XCTAssertEqual(store.lamps.brightness, 0)
        store.send(.kelvin(6599)); XCTAssertEqual(store.lamps.kelvin, 6500)
        store.send(.kelvin(2360)); XCTAssertEqual(store.lamps.kelvin, 2400)
        store.send(.party(.medium)); XCTAssertEqual(store.lamps.party.interval, 8)
        store.send(.toggle(.lamps)); XCTAssertEqual(store.lamps.party, .off)
    }
    func testClimateBoundsAndGapAcrossRepeatedSteps() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.target(100)); XCTAssertEqual(store.climate.target, 77)
        store.send(.target(20)); XCTAssertEqual(store.climate.target, 67)
        store.send(.mode(.heatCool))
        for value in -20...100 {
            store.send(.low(value)); store.send(.high(100 - value))
            XCTAssertGreaterThanOrEqual(store.climate.low, 67)
            XCTAssertLessThanOrEqual(store.climate.high, 77)
            XCTAssertGreaterThanOrEqual(store.climate.high - store.climate.low, 2)
        }
        store.send(.shiftRange(100)); XCTAssertEqual(store.climate.high, 77)
        store.send(.shiftRange(-100)); XCTAssertEqual(store.climate.low, 67)
    }
    func testPendingTracksLatestMutation() async throws {
        let store = MockHomeDataSource(latency: .milliseconds(150))
        store.send(.toggle(.fan)); XCTAssertTrue(store.pending.contains("fan"))
        try await Task.sleep(for: .milliseconds(90))
        store.send(.toggle(.fan))
        try await Task.sleep(for: .milliseconds(90))
        XCTAssertTrue(store.pending.contains("fan"))
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(store.pending.contains("fan"))
        XCTAssertEqual(store.climate.fanLabel, "Auto")
    }
    func testColorsValidateAndMoodAssignsUniquePalette() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.color(0, "invalid")); XCTAssertEqual(store.lamps.colors[0], "#ff0000")
        store.send(.color(1, "#ABCDEF")); XCTAssertEqual(store.lamps.colors[1], "#abcdef")
        XCTAssertEqual(store.lamps.activeColor, 1)
        store.send(.scene("Mood")); XCTAssertEqual(Set(store.lamps.lampColors).count, 8)
        XCTAssertNil(store.lamps.activeColor)
    }
    func testWiFiFixtures() async {
        XCTAssertEqual(MockHomeDataSource().wifi.password, "fixture-password-123")
        XCTAssertNil(MockHomeDataSource(wifiFixture: "open").wifi.password)
        XCTAssertNil(MockHomeDataSource(wifiFixture: "unconfigured").wifi.ssid)
    }
    func testSoundLockCalibrationAndGroups() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.calibrate)
        XCTAssertTrue(store.rooms.allSatisfy { $0.displayVolume == 50 })
        store.send(.groupLock)
        store.send(.volume("Desk", 75))
        XCTAssertEqual(store.rooms[0].displayVolume, 75)
        XCTAssertEqual(store.rooms[1].displayVolume, 75)
        XCTAssertEqual(store.rooms[2].displayVolume, 50)
        store.send(.globalLock)
        store.send(.volume("Desk", 50))
        XCTAssertTrue(store.rooms.allSatisfy { $0.displayVolume == 50 })
        store.send(.joinAll("Living Room"))
        XCTAssertTrue(store.rooms.allSatisfy { $0.coordinator == "Living Room" && $0.playing })
        store.send(.leave("Living Room"))
        XCTAssertEqual(store.rooms[0].coordinator, "Living Room")
        XCTAssertFalse(store.rooms[0].playing)
        XCTAssertTrue(store.rooms.dropFirst().allSatisfy { $0.coordinator == "Desk" })
        store.send(.clearCalibration)
        XCTAssertTrue(store.rooms.allSatisfy { $0.baseline == nil })
        XCTAssertFalse(store.globalLock)
    }
    func testAlarmValidationSchedulingAndEditing() async {
        let store = MockHomeDataSource(latency: .zero)
        var alarm = Alarm(label: "Wake", time: "07:00", repeatDays: [1,2,3,4,5])
        let now = ISO8601DateFormatter().date(from: "2026-10-29T22:41:00Z")!
        XCTAssertEqual(alarm.next(after: now), ISO8601DateFormatter().date(from: "2026-10-30T14:00:00Z"))
        alarm.timeZone = "Invalid/Zone"; XCTAssertNotNil(alarm.validationError)
        store.send(.saveAlarm(alarm)); XCTAssertEqual(store.alarms.count, 2)
        alarm.timeZone = "America/Los_Angeles"; alarm.date = "2026-10-31"
        store.send(.saveAlarm(alarm)); XCTAssertEqual(store.alarms.count, 3)
        XCTAssertEqual(store.alarms.last?.repeatDays, [])
        store.send(.enableAlarm(3, false)); XCTAssertFalse(store.alarms.last!.enabled)
        store.send(.deleteAlarm(3)); XCTAssertEqual(store.alarms.count, 2)
        alarm.date = "2027-03-14"; alarm.time = "02:30"
        XCTAssertNotNil(alarm.validationError)
    }
}
