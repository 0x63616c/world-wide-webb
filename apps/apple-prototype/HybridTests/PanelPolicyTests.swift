import Foundation
import XCTest
@testable import Panel

final class ModuleFlagsTests: XCTestCase {
    func testEveryModuleDefaultsToWeb() {
        let flags = ModuleFlags()
        XCTAssertEqual(Set(PanelModule.allCases.map(\.rawValue)), ["all", "lights", "climate", "fan", "wifi", "sonos", "weather", "photos", "walk", "reminders", "alarms"])
        for module in PanelModule.allCases { XCTAssertEqual(flags[module], .web) }
    }

    func testWalkFlagRequiresLiveDataAndDefaultsToWeb() {
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .walk, hasLiveData: true), .webBoard)
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.walk": "native"]))
        XCTAssertEqual(router.route(for: .walk, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .walk, hasLiveData: true), .native(.walk))
    }

    func testShippedDefaultsAreNativeOnlyForLiveVerifiedModules() {
        let flags = ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)
        for module in [PanelModule.lights, .climate, .fan, .wifi, .sonos, .weather, .walk] {
            XCTAssertEqual(flags[module], .native, module.rawValue)
        }
        XCTAssertEqual(flags[.all], .web)
        XCTAssertEqual(flags[.photos], .web)
        XCTAssertEqual(flags[.alarms], .web)
        let router = HybridRouter(flags: flags)
        XCTAssertEqual(router.route(for: .photos, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .lights, hasLiveData: true), .native(.lights))
    }

    func testFlipBackPerModuleAndWebOnlySwitch() {
        let perModule = ModuleFlags(overrides: ["moduleFlag.lights": "web", "moduleFlag.fan": "default",
                                                "moduleFlag.sonos": "bogus"],
                                    nativeByDefault: ModuleFlags.shippedNative)
        XCTAssertEqual(perModule[.lights], .web)
        XCTAssertEqual(perModule[.fan], .native)
        XCTAssertEqual(perModule[.sonos], .web)
        let webOnly = ModuleFlags(overrides: ["moduleFlag.climate": "native"],
                                  nativeByDefault: ModuleFlags.shippedNative, webOnly: true)
        for module in PanelModule.allCases { XCTAssertEqual(webOnly[module], .web) }
    }

    func testWebOnlySwitchIsReadFromUserDefaults() throws {
        let name = "PanelTests.webOnly"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertEqual(ModuleFlags(defaults: defaults, nativeByDefault: ModuleFlags.shippedNative)[.weather], .native)
        defaults.set(true, forKey: ModuleFlags.webOnlyKey)
        XCTAssertEqual(ModuleFlags(defaults: defaults, nativeByDefault: ModuleFlags.shippedNative)[.weather], .web)
    }

    func testOverridesAreIndependentAndInvalidValuesFailToWeb() {
        let flags = ModuleFlags(overrides: ["moduleFlag.lights": "native", "moduleFlag.fan": "web",
                                           "moduleFlag.weather": "NATIVE", "moduleFlag.unknown": "native"])
        XCTAssertEqual(flags[.lights], .native)
        XCTAssertEqual(flags[.fan], .web)
        XCTAssertEqual(flags[.weather], .web)
        XCTAssertEqual(flags[.all], .web)
    }

    func testUserDefaultsAndLaunchArgumentDomain() throws {
        let name = "PanelTests.flags"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name); defaults.removeVolatileDomain(forName: UserDefaults.argumentDomain) }
        defaults.set("web", forKey: "moduleFlag.lights")
        defaults.set("native", forKey: "moduleFlag.climate")
        defaults.setVolatileDomain(["moduleFlag.lights": "native"], forName: UserDefaults.argumentDomain)
        XCTAssertEqual(ModuleFlags(defaults: defaults)[.lights], .native)
        XCTAssertEqual(ModuleFlags(defaults: defaults)[.climate], .native)
    }

    func testRouterNeedsBothFlagAndLiveDataAndAlwaysKeepsAllWeb() {
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.lights": "native", "moduleFlag.all": "native"]))
        XCTAssertEqual(router.route(for: .lights, hasLiveData: true), .native(.lights))
        XCTAssertEqual(router.route(for: .lights, hasLiveData: false), .webBoard)
        XCTAssertEqual(router.route(for: .climate, hasLiveData: true), .webBoard)
        XCTAssertEqual(router.route(for: .all, hasLiveData: true), .webBoard)
        XCTAssertTrue(router.usesWebBoardOnly(enabled: Set(PanelModule.allCases), liveModules: []))
        XCTAssertFalse(router.usesWebBoardOnly(enabled: [.lights, .weather], liveModules: [.lights]))
        XCTAssertTrue(router.usesWebBoardOnly(enabled: [.weather], liveModules: [.lights]))
    }
}

final class KioskPolicyTests: XCTestCase {
    private let server = URL(string: "https://app.worldwidewebb.co")!

    func testKioskAllowListMatchesExpo() {
        for url in ["about:blank", "blob:https://app.worldwidewebb.co/id", "https://app.worldwidewebb.co/path",
                    "http://localhost:5173/", "https://manage.worldwidewebb.co", "https://APP.WORLDWIDEWEBB.CO/"] {
            XCTAssertTrue(KioskURLPolicy.isAllowed(url, serverURL: server), url)
        }
        for url in ["https://example.com", "https://worldwidewebb.co", "https://evilworldwidewebb.co",
                    "https://app.worldwidewebb.co.evil.example", "javascript:alert(1)", "file:///etc/passwd",
                    "data:text/html,test", "not a URL", "https://app.worldwidewebb.co@evil.example"] {
            XCTAssertFalse(KioskURLPolicy.isAllowed(url, serverURL: server), url)
        }
    }

    func testOriginIsStricterThanNavigationAllowList() {
        for raw in ["https://app.worldwidewebb.co", "https://APP.worldwidewebb.co:443/other"] {
            XCTAssertTrue(KioskURLPolicy.isTrusted(URL(string: raw), serverURL: server))
        }
        for raw in ["http://app.worldwidewebb.co", "https://app.worldwidewebb.co:8443", "https://app.worldwidewebb.co:0",
                    "https://manage.worldwidewebb.co", "http://localhost", "about:blank", "blob:https://app.worldwidewebb.co/id"] {
            XCTAssertFalse(KioskURLPolicy.isTrusted(URL(string: raw), serverURL: server))
        }
        XCTAssertFalse(KioskURLPolicy.isTrusted(nil, serverURL: server))
        XCTAssertEqual(WebOrigin(url: server), WebOrigin(scheme: "https", host: "app.worldwidewebb.co", port: 0))
    }

    func testBridgeRejectsSubframesAndUntrustedPagesOrSenders() {
        let origin = WebOrigin(url: server)
        XCTAssertTrue(KioskURLPolicy.acceptsMessage(isMainFrame: true, origin: origin, pageURL: server, serverURL: server))
        XCTAssertFalse(KioskURLPolicy.acceptsMessage(isMainFrame: false, origin: origin, pageURL: server, serverURL: server))
        XCTAssertFalse(KioskURLPolicy.acceptsMessage(isMainFrame: true, origin: nil, pageURL: server, serverURL: server))
        XCTAssertFalse(KioskURLPolicy.acceptsMessage(isMainFrame: true, origin: origin, pageURL: URL(string: "https://example.com"), serverURL: server))
        XCTAssertFalse(KioskURLPolicy.acceptsMessage(isMainFrame: true, origin: WebOrigin(scheme: "http", host: "app.worldwidewebb.co", port: 80), pageURL: server, serverURL: server))
    }

    func testBrowserURLsRejectNonHTTPAndEmbeddedCredentials() {
        XCTAssertNotNil(KioskURLPolicy.httpURL("https://example.com/page?q=value"))
        for url in ["javascript:alert(1)", "file:///tmp/test", "https://user:password@example.com", "/relative", "https://"] {
            XCTAssertNil(KioskURLPolicy.httpURL(url), url)
        }
    }

    func testBootURLPreservesRouteQueryAndFragmentAndReplacesStamp() {
        let url = KioskBoot.url(serverURL: URL(string: "https://app.worldwidewebb.co/board?theme=dark&boot=old#alarms")!, generation: 3, launchedAt: 123456789)
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(parts.path, "/board")
        XCTAssertEqual(parts.fragment, "alarms")
        XCTAssertEqual(parts.queryItems, [URLQueryItem(name: "theme", value: "dark"), URLQueryItem(name: "boot", value: "3-123456789")])
        XCTAssertNotEqual(url, KioskBoot.url(serverURL: url, generation: 4, launchedAt: 123456789))
        XCTAssertNotEqual(url, KioskBoot.url(serverURL: url, generation: 3, launchedAt: 123456790))
    }

    func testBootDeadlinesAndBackoffAreBounded() {
        XCTAssertEqual((0...5).map(KioskBoot.timeout), [30, 60, 90, 120, 120, 120])
        XCTAssertEqual((0...7).map(KioskBoot.recoveryDelay), [1, 2, 4, 8, 16, 30, 30, 30])
        XCTAssertEqual(KioskBoot.recoveryDelay(attempt: 1_000), 30)
    }
}

final class BridgeProtocolTests: XCTestCase {
    func testRequestParsingPreservesParamsAndAllowsUnknownMethodForErrorResponse() throws {
        let request = try XCTUnwrap(NativeRequest.parse(#"{"channel":"control-center-native","id":"request-test","method":"setBrightness","params":{"level":0.3}}"#))
        XCTAssertEqual(request.id, "request-test")
        XCTAssertEqual(request.params?["level"], .number(0.3))
        XCTAssertNotNil(NativeRequest.parse(#"{"channel":"control-center-native","id":"request-test","method":"futureMethod"}"#))
    }

    func testInvalidRequestsAreIgnored() {
        for raw in ["not json", "[]", "null", "{}",
                    #"{"channel":"other","id":"request-test","method":"deviceInfo"}"#,
                    #"{"channel":"control-center-native","id":1,"method":"deviceInfo"}"#,
                    #"{"channel":"control-center-native","id":"request-test"}"#,
                    #"{"channel":"control-center-native","id":"request-test","method":"share","params":[]}"#] {
            XCTAssertNil(NativeRequest.parse(raw), raw)
        }
    }

    func testResponseEncodingPreservesUntrustedStringsAsData() throws {
        let id = "quote\"\\\n'); window.bad = true; //\u{2028}"
        let response = NativeResponse.success(id: id, result: .object(["batteryLevel": .null, "isCharging": .bool(false)]))
        let object = try JSONDecoder().decode(JSONValue.self, from: Data(response.encoded().utf8))
        XCTAssertEqual(object, .object(["channel": .string("control-center-native"), "id": .string(id), "ok": .bool(true),
                                       "result": .object(["batteryLevel": .null, "isCharging": .bool(false)])]))
        let failure = NativeResponse.failure(id: "request-test", message: "Unavailable")
        let decoded = try JSONDecoder().decode(JSONValue.self, from: Data(failure.encoded().utf8))
        XCTAssertEqual(decoded, .object(["channel": .string("control-center-native"), "id": .string("request-test"),
                                        "ok": .bool(false), "error": .string("Unavailable")]))
        let success = try JSONDecoder().decode(JSONValue.self, from: Data(NativeResponse.success(id: "request-test").encoded().utf8))
        guard case .object(let fields) = success else { return XCTFail("Expected object") }
        XCTAssertEqual(fields["result"], .null)
    }

    func testBrightnessClampsAndRejectsWrongTypes() {
        XCTAssertEqual(BridgeParameters.brightness(["level": .number(-1)]), 0)
        XCTAssertEqual(BridgeParameters.brightness(["level": .number(2)]), 1)
        XCTAssertEqual(BridgeParameters.brightness(["level": .number(0.4)]), 0.4)
        XCTAssertNil(BridgeParameters.brightness(["level": .string("0.4")]))
        XCTAssertNil(BridgeParameters.brightness(["level": .bool(true)]))
        XCTAssertNil(BridgeParameters.brightness(["level": .number(.infinity)]))
        XCTAssertNil(BridgeParameters.brightness(nil))
    }

    func testBootReportsRequireChannelAndBoolean() {
        XCTAssertEqual(BootReport.parse(#"{"channel":"control-center-shell","rendered":true}"#)?.rendered, true)
        XCTAssertEqual(BootReport.parse(#"{"channel":"control-center-shell","rendered":false}"#)?.rendered, false)
        XCTAssertNil(BootReport.parse(#"{"channel":"control-center-shell","rendered":1}"#))
        XCTAssertNil(BootReport.parse(#"{"channel":"control-center-native","rendered":true}"#))
    }
}

final class ConfigurationTests: XCTestCase {
    func testMissingSettingsLoadWithoutHeaders() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "PanelTests.configuration.empty"))
        let config = PanelConfiguration(info: [:], defaults: defaults, environment: [:])
        XCTAssertEqual(config.serverURL.absoluteString, "https://app.worldwidewebb.co")
        XCTAssertTrue(config.accessHeaders.isEmpty)
        XCTAssertTrue(config.alarmAPIToken.isEmpty)
    }

    func testURLOverridesPreferEnvironmentThenDefaultsThenPlist() throws {
        let name = "PanelTests.configuration.precedence"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let info = ["PanelServerURL": "https://plist.example"]
        XCTAssertEqual(PanelConfiguration(info: info, defaults: defaults, environment: [:]).serverURL.host, "plist.example")
        defaults.set("https://defaults.example", forKey: "serverUrl")
        XCTAssertEqual(PanelConfiguration(info: info, defaults: defaults, environment: [:]).serverURL.host, "defaults.example")
        XCTAssertEqual(PanelConfiguration(info: info, defaults: defaults, environment: ["PANEL_SERVER_URL": "https://environment.example"]).serverURL.host, "environment.example")
    }

    func testUnresolvedBuildSettingsAreEmpty() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "PanelTests.configuration.empty"))
        let config = PanelConfiguration(info: ["PanelServerURL": "$(PANEL_SERVER_URL)", "PanelCFAccessClientID": "$(PANEL_CF_ACCESS_CLIENT_ID)",
                                               "PanelCFAccessClientSecret": "$(PANEL_CF_ACCESS_CLIENT_SECRET)"], defaults: defaults, environment: [:])
        XCTAssertTrue(config.accessHeaders.isEmpty)
        XCTAssertEqual(config.serverURL.host, "app.worldwidewebb.co")
    }
}
