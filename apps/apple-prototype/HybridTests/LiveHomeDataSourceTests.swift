import Foundation
import Observation
import XCTest
import PanelKit
@testable import Panel

@MainActor final class LiveHomeDataSourceTests: XCTestCase {
    private func fixtureTransport(writes: Bool = false, fanOffSupported: Bool = false, unavailable: Bool = false) throws -> HybridFixtureTransport {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL)
            .appendingPathComponent("Fixtures")
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("all-on.json").path))
        return HybridFixtureTransport(root: root, unavailable: unavailable, controlWrites: writes, fanOffSupported: fanOffSupported)
    }

    private func source(_ transport: HybridFixtureTransport) -> LiveHomeDataSource {
        LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "http://localhost:18733")!), transport: transport,
            remindersAPI: HybridRemindersFixture(unavailable: false), mediaAPI: HybridMediaFixture(unavailable: false),
            calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root:
                Bundle(for: LiveHomeDataSource.self).resourceURL!.appendingPathComponent("Fixtures"))),
            now: { HybridCalendarFixtureStore.now }, calendar: { HybridCalendarFixtureStore.calendar })
    }

    private func refreshAll(_ store: LiveHomeDataSource) async {
        for module in PanelModule.allCases { await store.refresh(module) }
    }

    func testPhotosRequiresOptInAndNonemptyLiveListings() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.photos": "native"]))
        XCTAssertEqual(router.route(for: .photos, hasLiveData: store.hasLiveData(for: .photos)), .webBoard)
        await store.refresh(.photos)
        XCTAssertEqual(store.photos.photos.count, 2)
        XCTAssertEqual(router.route(for: .photos, hasLiveData: store.hasLiveData(for: .photos)), .native(.photos))
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .photos, hasLiveData: true), .webBoard)
        await transport.setFixture("photos/empty-booth.json", for: "boothPhotos.list")
        await transport.setFixture("photos/empty-wakes.json", for: "wakePhotos.list")
        await store.refresh(.photos)
        XCTAssertFalse(store.hasLiveData(for: .photos))
        XCTAssertEqual(router.route(for: .photos, hasLiveData: store.hasLiveData(for: .photos)), .webBoard)
    }

    func testInitializationAndWebDefaultsStartNoProviders() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        await store.run(modules: [])
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
        for module in PanelModule.allCases { XCTAssertFalse(store.hasLiveData(for: module)) }
        XCTAssertFalse(store.lamps.anyOn)
        XCTAssertEqual(store.lamps.brightness, 0)
        XCTAssertEqual(store.lamps.scene, "Unavailable")
        XCTAssertEqual(store.lamps.colors, ["", "", ""])
        XCTAssertEqual(store.climate.ambient, 0)
        XCTAssertEqual(store.climate.action, "Unavailable")
        XCTAssertEqual(store.climate.fanLabel, "Unavailable")
        XCTAssertNil(store.wifi.ssid)
        XCTAssertNil(store.wifi.password)
        XCTAssertTrue(store.weather.hours.isEmpty)
        XCTAssertEqual(store.weather.city, "Unavailable")
        XCTAssertTrue(store.rooms.isEmpty)
        XCTAssertTrue(store.alarms.isEmpty)
        XCTAssertNil(store.occurrence)
        XCTAssertTrue(store.calendar.events.isEmpty)
        XCTAssertTrue(store.photos.photos.isEmpty)
        XCTAssertTrue(store.cameras.feeds.isEmpty)
        XCTAssertTrue(store.media.items.isEmpty)
        XCTAssertNil(store.media.videoURL)
        XCTAssertTrue(store.walks.history.isEmpty)
        XCTAssertNil(store.walks.activeWalk)
        XCTAssertEqual(store.tesla.availability, .offline)
    }

    func testAllLiveProvidersProjectExistingFixtures() async throws {
        let store = source(try fixtureTransport())
        await refreshAll(store)
        for module in PanelModule.allCases where module != .all { XCTAssertTrue(store.hasLiveData(for: module), module.rawValue) }
        XCTAssertFalse(store.hasLiveData(for: .all))
        XCTAssertTrue(store.walks === store.walkProvider)
        XCTAssertNil(store.walks.activeWalk)
        XCTAssertFalse(store.walks.history.isEmpty)
        XCTAssertEqual(store.lamps.onCount(), 8)
        XCTAssertEqual(store.lamps.brightness, 65)
        XCTAssertEqual(store.lamps.kelvin, 2700)
        XCTAssertEqual(store.climate.mode, .cool)
        XCTAssertEqual(store.climate.target, 70)
        XCTAssertTrue(store.climate.fanOn)
        XCTAssertEqual(store.climate.fanLabel, "On")
        XCTAssertNotNil(store.wifi.ssid)
        XCTAssertEqual(store.weather.city, "Example City")
        XCTAssertEqual(store.weather.temperature, 63)
        XCTAssertEqual(store.weather.high, 68)
        XCTAssertEqual(store.weather.low, 51)
        XCTAssertEqual(store.weather.humidity, 70)
        XCTAssertEqual(store.weather.wind, 10)
        XCTAssertFalse(store.weather.hours.isEmpty)
        XCTAssertEqual(store.rooms.count, 4) // Unknown/unavailable devices are not actionable.
        XCTAssertEqual(store.rooms[0].name, store.rooms[1].name)
        XCTAssertNotEqual(store.rooms[0].id, store.rooms[1].id)
        XCTAssertEqual(store.rooms[1].coordinator, store.rooms[0].id)
        XCTAssertEqual(store.rooms[1].coordinatorLabel, "Test Room")
        XCTAssertEqual(store.rooms[0].trackTitle, "Synthetic Track")
        XCTAssertEqual(store.rooms[0].trackArtist, "Fixture Artist")
        XCTAssertEqual(store.rooms[0].displayVolume, 50)
        XCTAssertEqual(store.rooms[1].displayVolume, 150)
        XCTAssertEqual(store.rooms[0].durationSeconds, 0)
        XCTAssertEqual(store.rooms[0].position(at: .now), 0)
        XCTAssertNil(store.rooms[2].trackTitle)
        XCTAssertNil(store.rooms[3].trackTitle) // Missing metadata on a non-idle source must stay nil.
        XCTAssertEqual(store.rooms[3].sourceKind, .lineIn)
    }

    func testRouterRequiresEachIndependentFlagEvenAfterLiveReads() async throws {
        let store = source(try fixtureTransport())
        await refreshAll(store)
        let defaults = HybridRouter(flags: ModuleFlags())
        for module in PanelModule.allCases {
            XCTAssertEqual(defaults.route(for: module, hasLiveData: store.hasLiveData(for: module)), .webBoard)
            let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.\(module.rawValue)": "native"]))
            for candidate in PanelModule.allCases {
                let expected: HybridRouter.Route = candidate == module && candidate != .all ? .native(candidate) : .webBoard
                XCTAssertEqual(router.route(for: candidate, hasLiveData: store.hasLiveData(for: candidate)), expected)
            }
        }
    }

    func testOneFailedProviderFallsBackWithoutLosingOthersThenRecovers() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        await refreshAll(store)
        await transport.setFixture("weather/empty-db.json", for: "weather.now")
        await store.refresh(.weather)
        XCTAssertFalse(store.hasLiveData(for: .weather))
        XCTAssertTrue(store.weather.hours.isEmpty)
        XCTAssertEqual(store.weather.temperature, 0)
        for module in [PanelModule.lights, .climate, .fan, .wifi, .sonos] { XCTAssertTrue(store.hasLiveData(for: module)) }
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.weather": "native"]))
        XCTAssertEqual(router.route(for: .weather, hasLiveData: store.hasLiveData(for: .weather)), .webBoard)
        await transport.setFixture("weather/now.json", for: "weather.now")
        await store.refresh(.weather)
        XCTAssertEqual(router.route(for: .weather, hasLiveData: store.hasLiveData(for: .weather)), .native(.weather))
    }

    func testEmptyAndUnavailableResponsesNeverBecomeNative() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        await refreshAll(store)
        for (procedure, fixture, module) in [
            ("wifi.guestQr", "wifi/unconfigured.json", PanelModule.wifi),
            ("sound.soundSystem", "sonos/empty.json", .sonos),
            ("weather.hourly", "weather/empty-hourly.json", .weather)
        ] {
            await transport.setFixture(fixture, for: procedure)
            await store.refresh(module)
            XCTAssertFalse(store.hasLiveData(for: module))
        }
        XCTAssertNil(store.wifi.ssid)
        XCTAssertNil(store.wifi.password)
        XCTAssertTrue(store.rooms.isEmpty)
        XCTAssertTrue(store.weather.hours.isEmpty)
        for (procedure, module) in [("controls.list", PanelModule.lights), ("climate.get", .climate), ("controls.list", .fan)] {
            await transport.setFixture("sonos/unavailable.json", for: procedure)
            await store.refresh(module)
            XCTAssertFalse(store.hasLiveData(for: module))
        }
        XCTAssertEqual(store.climate.fanLabel, "Unavailable")
        XCTAssertEqual(store.climate.ambient, 0)
        XCTAssertFalse(store.lamps.anyOn)
        XCTAssertTrue(store.pending.isEmpty)
    }

    func testOffClimateDoesNotExposeRememberedFixtureSetpoints() async throws {
        let transport = try fixtureTransport()
        await transport.setFixture("climate/off.json", for: "climate.get")
        let store = source(transport)
        await store.refresh(.climate)
        XCTAssertTrue(store.hasLiveData(for: .climate))
        XCTAssertEqual(store.climate.mode, .off)
        XCTAssertEqual(store.climate.target, 0)
        XCTAssertEqual(store.climate.low, 0)
        XCTAssertEqual(store.climate.high, 0)
        XCTAssertEqual(store.climate.ambient, 72)
        XCTAssertEqual(store.climate.action, "Idle")
        XCTAssertEqual(store.climate.fanLabel, "Unavailable")
    }

    func testFanStateIsIndependentOfClimateIncludingAutoAndOff() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        for (file, on, label) in [("on", true, "On"), ("auto", false, "Auto"), ("off", false, "Off")] {
            await transport.setFixture("fan/\(file).json", for: "controls.list")
            await store.refresh(.fan)
            XCTAssertTrue(store.hasLiveData(for: .fan))
            XCTAssertFalse(store.hasLiveData(for: .climate))
            XCTAssertEqual(store.climate.fanOn, on)
            XCTAssertEqual(store.climate.fanLabel, label)
            XCTAssertEqual(store.climate.ambient, 0)
        }
    }

    func testMissingLampFieldsDoNotInheritMockValuesAndPendingNamesMap() async throws {
        let transport = try fixtureTransport()
        await transport.setFixture("null-scene.json", for: "controls.list")
        let store = source(transport)
        await store.refresh(.lights)
        XCTAssertEqual(store.lamps.scene, "Unavailable")
        XCTAssertEqual(store.lamps.lampColors, Array(repeating: "#000000", count: 8))
        await transport.setFixture("all-on.json", for: "controls.list")
        await store.refresh(.lights)
        XCTAssertEqual(store.lamps.scene, "White")
        await transport.setFixture("null-scene.json", for: "controls.list")
        await store.refresh(.lights)
        XCTAssertEqual(store.lamps.scene, "Unavailable") // A later null must also clear the previous scene.
        await transport.setFixture("pending.json", for: "controls.list")
        await store.refresh(.lights)
        let expected = Set(store.lightsProvider.pending.filter { $0 != "fan" }.map {
            $0 == "bedroomLamps" ? "bedroom" : $0 == "otherLamps" ? "livingRoom" : $0
        })
        XCTAssertEqual(store.pending, expected)
    }

    func testObservationTracksProviderRefreshThroughComposedProperties() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        let changed = expectation(description: "Composed source invalidates the view")
        withObservationTracking {
            _ = store.weather.temperature
        } onChange: { changed.fulfill() }
        await store.refresh(.weather)
        await fulfillment(of: [changed], timeout: 2)
    }

    func testUnavailableAndUnsupportedCommandsNeverFallBackToMocksOrNetwork() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        store.send(.toggle(.lamps))
        store.send(.toggle(.fan))
        store.send(.target(72))
        store.send(.volume("unknown", 40))
        store.send(.saveAlarm(Alarm()))
        store.send(.playMedia("fixture", 0))
        store.send(.seek("unknown", 30))
        // Walk views receive the guarded server-time adapter from HybridNativeModule.
        HybridWalkDataSource(store: store).toggleWalk()
        await Task.yield()
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
        XCTAssertTrue(store.alarms.isEmpty)
        XCTAssertNil(store.walks.activeWalk)
    }

    func testCommandsReachTheCorrectProviderAndUseStableSonosIDs() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        await refreshAll(store)
        await transport.setFixture("fan/off.json", for: "controls.toggle")
        store.send(.toggle(.fan))
        try await waitFor { store.climate.fanLabel == "Off" }
        var requests = await transport.requests
        var input = try XCTUnwrap(requests.last?.httpBody)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: input) as? [String: Any])
        XCTAssertEqual(object["key"] as? String, "fan")
        XCTAssertEqual(object["on"] as? Bool, false)
        XCTAssertTrue(store.lamps.anyOn) // Fan acknowledgements cannot overwrite lamp state.

        await transport.setFixture("all-off.json", for: "controls.toggle")
        store.send(.toggle(.lamps))
        try await waitFor { !store.lamps.anyOn && store.pending.isEmpty }
        requests = await transport.requests
        input = try XCTUnwrap(requests.last?.httpBody)
        object = try XCTUnwrap(JSONSerialization.jsonObject(with: input) as? [String: Any])
        XCTAssertEqual(object["key"] as? String, "lamps")

        await transport.setFixture("climate/heat.json", for: "climate.setMode")
        store.send(.mode(.heat))
        try await waitFor { store.climate.mode == .heat && store.pending.isEmpty }
        XCTAssertEqual(store.climate.fanLabel, "Off")

        await transport.setFixture("sonos/void.json", for: "sound.sonosSetVolume")
        store.send(.volume("media_player.test_alpha", 40))
        try await waitFor { store.pending.isEmpty }
        requests = await transport.requests
        let volume = try XCTUnwrap(requests.first { $0.url?.lastPathComponent == "sound.sonosSetVolume" })
        object = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(volume.httpBody)) as? [String: Any])
        XCTAssertEqual(object["deviceIp"] as? String, "media_player.test_alpha")
        XCTAssertEqual(object["volume"] as? Int, 48) // 40% of the fixture's 120 baseline.
        XCTAssertEqual(store.sonosProvider.availability, .live)

        let before = requests.count
        store.send(.joinAll("Test Room")) // Two rooms share this label: ambiguous shortcut is rejected.
        store.send(.seek("media_player.test_alpha", 50))
        store.send(.playMedia("fixture", 0))
        await Task.yield()
        requests = await transport.requests
        XCTAssertEqual(requests.count, before)
        store.stop()
    }

    func testEveryInlineControlReachesTheExactBackendProcedureAndInput() async throws {
        let cases: [(HomeCommand, String, Any)] = [
            (.toggle(.lamps), "controls.toggle", ["key": "lamps", "on": false] as [String: Any]),
            (.toggle(.lights), "controls.toggle", ["key": "lights", "on": false] as [String: Any]),
            (.toggle(.bedroom), "controls.toggle", ["key": "bedroomLamps", "on": false] as [String: Any]),
            (.toggle(.livingRoom), "controls.toggle", ["key": "otherLamps", "on": false] as [String: Any]),
            (.toggle(.ceiling), "controls.toggle", ["key": "ceiling", "on": false] as [String: Any]),
            (.toggle(.cabinet), "controls.toggle", ["key": "cabinet", "on": false] as [String: Any]),
            (.toggle(.all), "controls.toggle", ["key": "all", "on": false] as [String: Any]),
            (.brightness(30), "controls.setLampBrightness", ["pct": 30] as [String: Any]),
            (.kelvin(3200), "controls.setWhiteKelvin", ["kelvin": 3200] as [String: Any]),
            (.scene("white"), "controls.setLampScene", ["scene": "white"] as [String: Any]),
            (.color(0, "#123456"), "controls.setLampColor", ["slot": "red", "hex": "#123456"] as [String: Any]),
            (.party(.fast), "controls.setLampMode", ["mode": "party", "speed": "fast"] as [String: Any]),
            (.mode(.heat), "climate.setMode", "heat"),
            (.target(72), "climate.setTarget", 72),
            (.low(68), "climate.setRange", ["low": 68, "high": 73] as [String: Any]),
            (.high(74), "climate.setRange", ["low": 67, "high": 74] as [String: Any]),
            (.shiftRange(1), "climate.setRange", ["low": 68, "high": 74] as [String: Any]),
            (.toggle(.fan), "controls.toggle", ["key": "fan", "on": false] as [String: Any]),
            (.fan(true), "controls.toggle", ["key": "fan", "on": true] as [String: Any]),
            (.fan(false), "controls.toggle", ["key": "fan", "on": false] as [String: Any]),
            (.fanMode("on"), "controls.toggle", ["key": "fan", "on": true] as [String: Any]),
            (.fanMode("auto"), "controls.toggle", ["key": "fan", "on": false] as [String: Any]),
            (.fanMode("off"), "controls.setFanMode", ["mode": "off"] as [String: Any]),
        ]
        for (command, procedure, input) in cases {
            let transport = try fixtureTransport(writes: true, fanOffSupported: true)
            let store = source(transport)
            for module in [PanelModule.lights, .climate, .fan] { await store.refresh(module) }
            store.send(command)
            try await waitFor { store.pending.isEmpty }
            let writes = await transport.requests.filter { $0.httpMethod == "POST" }
            XCTAssertEqual(writes.count, 1, procedure)
            let request = try XCTUnwrap(writes.first, procedure)
            XCTAssertEqual(request.url?.lastPathComponent, procedure)
            let actual = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody), options: .fragmentsAllowed)
            let actualJSON = try JSONSerialization.data(withJSONObject: actual, options: [.fragmentsAllowed, .sortedKeys])
            let expectedJSON = try JSONSerialization.data(withJSONObject: input, options: [.fragmentsAllowed, .sortedKeys])
            XCTAssertEqual(actualJSON, expectedJSON, procedure)
            XCTAssertNil(store.errorMessage)
            store.stop()
        }
    }

    func testDroppedModuleCommandLogsSafePayloadWithoutHTTPStatus() throws {
        let store = source(try fixtureTransport())
        store.send(.target(72))
        let entry = try XCTUnwrap(PanelCommandLog.shared.snapshot().last)
        XCTAssertEqual(entry.control, "target")
        XCTAssertEqual(entry.error, "dropped: module not live")
        XCTAssertNil(entry.status)
        XCTAssertEqual(entry.payload, ["value": "72"])
        XCTAssertNotNil(store.errorMessage)
    }

    func testUnloadedAndUnsupportedCommandsExposeAnErrorWithoutNetworkWrites() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        for command in [HomeCommand.toggle(.lamps), .brightness(30), .kelvin(3000), .scene("white"),
                        .mode(.heat), .target(72), .low(68), .high(74), .fan(true), .fanMode("off"), .playMedia("fixture", 0)] {
            let revision = store.errorRevision
            store.send(command)
            XCTAssertNotNil(store.errorMessage)
            XCTAssertEqual(store.errorRevision, revision + 1)
        }
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testUnavailableModulesRejectCommandsVisiblyAfterFailedRefresh() async throws {
        let transport = try fixtureTransport(unavailable: true)
        let store = source(transport)
        let cases: [(PanelModule, HomeCommand)] = [(.lights, .toggle(.lamps)), (.climate, .target(72)), (.fan, .fan(false))]
        for (module, command) in cases {
            await store.refresh(module)
            XCTAssertFalse(store.hasLiveData(for: module))
            let revision = store.errorRevision
            store.send(command)
            XCTAssertNotNil(store.errorMessage)
            XCTAssertEqual(store.errorRevision, revision + 1)
        }
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertTrue(writes.isEmpty)
    }

    func testFanWithoutOffCapabilityRejectsOffVisibly() async throws {
        let transport = try fixtureTransport(writes: true)
        let store = source(transport)
        await store.refresh(.fan)
        XCTAssertEqual(store.climate.fanModes, ["auto", "on"])
        store.send(.fanMode("off"))
        XCTAssertNotNil(store.fanProvider.errorMessage)
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertTrue(writes.isEmpty)
    }

    func testPollingIsScopedAndCancellationStopsRequests() async throws {
        let transport = try fixtureTransport()
        let store = source(transport)
        let task = Task { await store.run(modules: [.wifi]) }
        try await waitFor { store.hasLiveData(for: .wifi) }
        task.cancel()
        await task.value
        store.stop()
        let requests = await transport.requests
        XCTAssertEqual(requests.map { $0.url!.lastPathComponent }, ["wifi.guestQr"])
    }

    private func waitFor(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Provider did not settle")
    }
}
