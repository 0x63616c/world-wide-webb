import Foundation
import XCTest
@testable import Panel

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
