import XCTest
import UIKit
import PanelKit
@testable import Panel

@MainActor final class PanelDiagnosticsTests: XCTestCase {
    func testModulesPreserveLiveAndUnconfiguredStates() async throws {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL)
            .appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        let store = LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://panel.example")!), transport: transport)
        await store.refresh(.tesla)
        let live = try XCTUnwrap(PanelDiagnosticsView.moduleStatuses(in: store).first { $0.module == "tesla" })
        XCTAssertEqual(live.status, "live")
        XCTAssertNil(live.reason)
        await transport.setFixture("tesla/unconfigured.json", for: "tesla.state")
        await store.refresh(.tesla)
        let unconfigured = try XCTUnwrap(PanelDiagnosticsView.moduleStatuses(in: store).first { $0.module == "tesla" })
        XCTAssertEqual(unconfigured.status, "unconfigured")
        XCTAssertEqual(unconfigured.reason, "Tesla isn't set up on the server")
    }

    func testModulesIncludeEveryProviderAndRefreshWithoutExposingTransportSecrets() async throws {
        let store = LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://panel.example")!,
            accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret"),
            transport: SecretDiagnosticsTransport())
        let initial = PanelDiagnosticsView.moduleStatuses(in: store)
        XCTAssertEqual(initial.map(\.module), HomeModule.allCases.map(\.rawValue))
        XCTAssertTrue(initial.allSatisfy { $0.status == "loading" && $0.reason == "Loading…" })
        await store.refresh(.weather)
        let updated = PanelDiagnosticsView.moduleStatuses(in: store)
        let weather = try XCTUnwrap(updated.first { $0.module == "weather" })
        XCTAssertEqual(weather.status, "unavailable")
        XCTAssertEqual(weather.reason, "Can't reach server")
        XCTAssertEqual(updated.first { $0.module == "lights" }?.status, "loading")
        let json = String(decoding: try JSONEncoder().encode(updated), as: UTF8.self)
        for secret in ["synthetic-id", "synthetic-secret", "private-token", "CF-Access"] {
            XCTAssertFalse(json.contains(secret))
        }
    }
    func testGestureAttachesOnlyToRootWindowAndRequiresThreeFingers() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1366, height: 1024))
        let face = UIView()
        window.addSubview(face)
        let attachment = PanelDiagnosticsAccess.AttachmentView(open: {})
        window.addSubview(attachment)
        XCTAssertTrue(attachment.recognizer.view === window)
        XCTAssertEqual(attachment.recognizer.numberOfTouchesRequired, 3)
        XCTAssertEqual(attachment.recognizer.minimumPressDuration, 1.5)
        XCTAssertTrue(face.gestureRecognizers?.isEmpty ?? true)
        attachment.removeFromSuperview()
        XCTAssertNil(attachment.recognizer.view)
    }
    func testInformationalFacesCannotOpenDestinations() {
        for tile in [HomeTile.clock, .weather, .hourly] {
            XCTAssertTrue(PanelHomePresentation.isInformationalFace(tile))
        }
        for tile in [HomeTile.alarm, .climate, .calendar, .sound, .wifi] {
            XCTAssertFalse(PanelHomePresentation.isInformationalFace(tile))
        }
    }
}

private actor SecretDiagnosticsTransport: PanelTransport {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        throw PanelAPIError.transport("https://synthetic-id:synthetic-secret@example.invalid/?token=private-token")
    }
}
