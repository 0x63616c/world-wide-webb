import Foundation
import PanelKit
import XCTest

@testable import Panel

final class ConfigurationTests: XCTestCase {
    func testDisconnectedDefaultsToAPIWithoutCredentials() {
        let config = PanelConfiguration(environment: [:], enrollment: nil)
        XCTAssertEqual(config.serverURL.absoluteString, "https://api.worldwidewebb.co")
        XCTAssertTrue(config.accessHeaders.isEmpty)
        XCTAssertTrue(config.apiToken.isEmpty)
    }

    func testDebugLoopbackOverrideUsesExplicitDevelopmentToken() {
        let config = PanelConfiguration(
            environment: ["PANEL_SERVER_URL": "http://localhost:18733", "WWW_API_TOKEN": "fixture-development-token"],
            enrollment: nil)
        XCTAssertEqual(config.serverURL.host, "localhost")
        XCTAssertEqual(config.apiToken, "fixture-development-token")
    }

    func testPrivatelyEnrolledCredentialsAreUsedTogether() throws {
        let enrollment = try PanelEnrollment.parse(
            """
            {"baseURL":"https://api.example.invalid","apiToken":"fixture-installation-token-at-least-32-bytes",\
            "accessClientID":"fixture-device","accessClientSecret":"fixture-secret"}
            """)
        let config = PanelConfiguration(environment: [:], enrollment: enrollment)
        XCTAssertEqual(config.serverURL.host, "api.example.invalid")
        XCTAssertEqual(config.apiToken, enrollment.apiToken)
        XCTAssertEqual(config.accessHeaders["CF-Access-Client-Id"], "fixture-device")
    }
}
