import Foundation
import PanelKit
import XCTest

@testable import Panel

final class ConfigurationTests: XCTestCase {
    func testDefaultUsesPrivateTailnetEndpointWithoutSetup() {
        let config = PanelConfiguration(environment: [:])
        XCTAssertEqual(config.serverURL, PanelKit.PanelConfiguration.defaultBaseURL)
        XCTAssertEqual(config.serverURL.host, "homelab.tail8c014d.ts.net")
        XCTAssertEqual(config.serverURL.scheme, "https")
    }
    func testDebugLoopbackOverrideIsIsolated() {
        let config = PanelConfiguration(environment: ["PANEL_SERVER_URL": "http://localhost:18733"])
        XCTAssertEqual(config.serverURL.host, "localhost")
    }
}
