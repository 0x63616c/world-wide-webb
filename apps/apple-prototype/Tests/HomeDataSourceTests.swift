import XCTest
@testable import WorldWideWebb

@MainActor final class HomeDataSourceTests: XCTestCase {
    func testPlaybackPositionSeekingAndGroupSync() async {
        let now = Date(timeIntervalSince1970: 1000)
        let store = MockHomeDataSource(latency: .zero, fixedNow: now)
        let room = store.rooms[0]
        XCTAssertEqual(room.position(at: now), 107)
        XCTAssertEqual(room.position(at: now.addingTimeInterval(10)), 117)
        XCTAssertEqual(room.position(at: now.addingTimeInterval(1000)), 232)
        XCTAssertEqual(room.position(at: now.addingTimeInterval(-10)), 107)
        store.send(.seek(room.id, 180))
        XCTAssertEqual(store.rooms[0].positionSeconds, 180)
        XCTAssertEqual(store.rooms[1].positionSeconds, 180)
        XCTAssertEqual(store.rooms[2].positionSeconds, 107)
        store.send(.transport(room.id, .pause))
        XCTAssertEqual(store.rooms[0].position(at: now.addingTimeInterval(90)), 180)
        store.send(.seek(room.id, -10))
        XCTAssertEqual(store.rooms[0].positionSeconds, 0)
        store.send(.seek(room.id, 500))
        XCTAssertEqual(store.rooms[0].positionSeconds, 232)
        store.send(.seek(room.id, .nan))
        XCTAssertEqual(store.rooms[0].positionSeconds, 232)
        store.send(.transport(room.id, .next))
        XCTAssertEqual(store.rooms[0].positionSeconds, 0)
        store.send(.seek(room.id, 100))
        store.send(.join("Bedroom", "Desk"))
        XCTAssertEqual(store.rooms[2].positionSeconds, 100)
        XCTAssertEqual(store.rooms[2].positionUpdatedAt, now)
    }
    func testGridHomePagesAreFullWithoutOverlap() {
        for page in 0...1 {
            var occupied = Set<String>()
            for placement in HomeGrid.placements(page: page) {
                let v = placement.variant
                XCTAssertTrue(["1x1", "2x1", "1x2", "2x2"].contains("\(v.w)x\(v.h)"))
                for y in placement.y..<(placement.y + v.h) {
                    for x in placement.x..<(placement.x + v.w) {
                        XCTAssertTrue((0..<6).contains(x) && (0..<4).contains(y))
                        XCTAssertTrue(occupied.insert("\(x),\(y)").inserted, "Overlapping card on page \(page + 1)")
                    }
                }
            }
            XCTAssertEqual(occupied.count, 24)
        }
        XCTAssertEqual(Set(HomeGrid.more.map(\.card)), [.nowPlaying, .cameras, .photos, .sonosRooms, .wifi, .dogwalk, .media])
        XCTAssertEqual(HomeGrid.more.first { $0.card == .sonosRooms }?.variant.w, 2)
    }
    func testMixedHomeSpansFillGridWithoutOverlap() {
        var occupied = Set<String>()
        for tile in HomeTile.homeFace {
            let c = MixedHomeLayout.cells(tile)
            XCTAssertTrue((1...2).contains(c.w) && (1...2).contains(c.h))
            for x in c.x..<(c.x + c.w) {
                for y in c.y..<(c.y + c.h) {
                    XCTAssertTrue(x >= 0 && x < 5 && y >= 0 && y < 3)
                    XCTAssertTrue(occupied.insert("\(x),\(y)").inserted)
                }
            }
        }
        XCTAssertEqual(occupied.count, 15)
    }
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
    func testLampCountsFollowRoomMembershipAndCommands() async {
        let store = MockHomeDataSource(latency: .zero)
        XCTAssertEqual(store.lamps.onCount(.bedroom), 3)
        XCTAssertEqual(store.lamps.onCount(.livingRoom), 0)
        XCTAssertEqual(store.lamps.countLabel(), "3 lamps on")
        store.send(.toggle(.cabinet))
        store.send(.toggle(.ceiling))
        XCTAssertEqual(store.lamps.onCount(), 3)
        store.send(.toggle(.livingRoom))
        XCTAssertEqual(store.lamps.onCount(), 8)
        store.send(.toggle(.bedroom))
        XCTAssertEqual(store.lamps.onCount(), 5)
        XCTAssertEqual(store.lamps.onCount(), store.lamps.onCount(.bedroom) + store.lamps.onCount(.livingRoom))
        store.send(.toggle(.lamps))
        XCTAssertEqual(store.lamps.countLabel(), "0 lamps on")
        XCTAssertFalse(store.lamps.isOn(.bedroom))
        XCTAssertFalse(store.lamps.isOn(.livingRoom))
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
        store.send(.join("Desk", "Living Room"))
        XCTAssertEqual(store.rooms[0].coordinator, "Desk")
        XCTAssertEqual(store.rooms[1].coordinator, "Desk")
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
    func testTransportFollowsCoordinatorAndVolumeIsPerRoom() async {
        let store = MockHomeDataSource(latency: .zero)
        store.send(.transport("Living Room", .pause))
        XCTAssertFalse(store.rooms[0].playing)
        XCTAssertFalse(store.rooms[1].playing)
        store.send(.transport("Living Room", .next))
        XCTAssertEqual(store.rooms[0].trackTitle, "After the Rain")
        XCTAssertEqual(store.rooms[1].trackTitle, "After the Rain")
        XCTAssertEqual(store.rooms[2].trackTitle, "Closer to the Sun")
        store.send(.transport("Desk", .previous))
        XCTAssertEqual(store.rooms[0].trackTitle, "Closer to the Sun")
        store.send(.transport("Desk", .play))
        XCTAssertTrue(store.rooms[0].playing)
        store.send(.rawVolume("Living Room", 72))
        XCTAssertEqual(store.rooms[0].rawVolume, 72)
        XCTAssertEqual(store.rooms[1].rawVolume, 32)
        store.send(.mute("Living Room"))
        XCTAssertTrue(store.rooms[0].muted)
        XCTAssertFalse(store.rooms[1].muted)
        store.send(.transport("Desk", .next))
        store.send(.join("Bedroom", "Desk"))
        XCTAssertEqual(store.rooms[2].trackTitle, "After the Rain")
        XCTAssertTrue(store.rooms[2].playing)
        store.send(.transport("Desk", .pause))
        store.send(.joinAll("Bedroom"))
        XCTAssertTrue(store.rooms.allSatisfy { !$0.playing && $0.trackTitle == "After the Rain" })
    }
    func testAlarmRingSnoozeStopAndStaleAction() async throws {
        let date = ISO8601DateFormatter().date(from: "2026-10-29T14:00:00Z")!
        let store = MockHomeDataSource(latency: .zero, fixedNow: date, ringing: true)
        let active = try XCTUnwrap(store.upcomingAlarm(at: date))
        XCTAssertTrue(active.ringing)
        XCTAssertEqual(active.ringFraction(at: date), 0)
        store.send(.snoozeAlarm(active.alarm.id, 99))
        XCTAssertTrue(store.upcomingAlarm(at: date)!.ringing)
        store.send(.snoozeAlarm(active.alarm.id, active.version!))
        let snoozed = try XCTUnwrap(store.upcomingAlarm(at: date))
        XCTAssertFalse(snoozed.ringing)
        XCTAssertEqual(snoozed.remaining(at: date), 9 * 60)
        XCTAssertTrue(snoozed.snoozed)
        XCTAssertEqual(snoozed.version, 1)
        store.send(.stopAlarm(active.alarm.id, active.version!))
        XCTAssertNotNil(store.occurrence)
        XCTAssertTrue(store.upcomingAlarm(at: date.addingTimeInterval(9 * 60))!.ringing)
        let ringing = MockHomeDataSource(latency: .zero, fixedNow: date, ringing: true)
        ringing.send(.stopAlarm(1, 0))
        XCTAssertNil(ringing.occurrence)
        XCTAssertFalse(ringing.upcomingAlarm(at: date)!.ringing)
        ringing.send(.enableAlarm(1, false))
        XCTAssertNil(ringing.upcomingAlarm(at: date))
    }

}
