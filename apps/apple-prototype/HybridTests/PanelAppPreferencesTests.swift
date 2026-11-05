import XCTest
@testable import Panel

@MainActor final class PanelAppPreferencesTests: XCTestCase {
    func testPreferencesPersistPerAppWithoutChangingOtherApps() {
        let suite = "PanelPreferencesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PanelAppPreferences(defaults: defaults)
        XCTAssertEqual(preferences["weather"].idleSeconds, -1)
        XCTAssertEqual(preferences.idleSeconds(for: "weather", default: 120), 120)
        preferences["weather"].idleSeconds = 300
        preferences["weather"].reduceMotion = true
        let restored = PanelAppPreferences(defaults: defaults)
        XCTAssertEqual(restored["weather"].idleSeconds, 300)
        XCTAssertTrue(restored["weather"].reduceMotion)
        XCTAssertEqual(restored.idleSeconds(for: "weather", default: 120), 300)
        restored["weather"].idleSeconds = 0
        XCTAssertEqual(restored.idleSeconds(for: "weather", default: 120), 0)
        XCTAssertEqual(restored["music"].idleSeconds, -1)
        XCTAssertFalse(restored["music"].reduceMotion)
    }
}
