import XCTest
import PanelKit
@testable import WorldWideWebb

@MainActor final class LiveRemindersProviderTests: XCTestCase {
    final class Fixture: RemindersServing {
        var rows = [PanelReminder(id: "fixture_one", title: "Synthetic task", list: "Test list", writable: true)]
        var fail = false
        enum Failure: Error { case denied }
        func list() async throws -> [PanelReminder] { if fail { throw Failure.denied }; return rows }
        func complete(id: String) async throws { rows.removeAll { $0.id == id } }
        func add(title: String) async throws {
            rows.append(.init(id: "fixture_added", title: title, list: "Test list", writable: true))
        }
    }
    func testListCompleteAddAndEmptySuccess() async {
        let api = Fixture()
        let provider = LiveRemindersProvider(api: api)
        await provider.refresh()
        XCTAssertEqual(provider.items, api.rows)
        await provider.complete(id: "fixture_one")
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertEqual(provider.availability, .live)
        await provider.add(title: "  Another task  ")
        XCTAssertEqual(provider.items.first?.title, "Another task")
        await provider.add(title: "  ")
        XCTAssertEqual(provider.items.count, 1)
    }
    func testDeniedClearsSnapshotAndRecovers() async {
        let api = Fixture()
        let provider = LiveRemindersProvider(api: api)
        await provider.refresh()
        api.fail = true
        await provider.refresh()
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertNotEqual(provider.availability, .live)
        api.fail = false
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
    }
    func testReadOnlyCompletionDoesNotWrite() async {
        let api = Fixture()
        api.rows = [.init(id: "readonly", title: "Shared task", list: "Test list", writable: false)]
        let provider = LiveRemindersProvider(api: api)
        await provider.refresh()
        await provider.complete(id: "readonly")
        XCTAssertEqual(api.rows.count, 1)
    }
}
