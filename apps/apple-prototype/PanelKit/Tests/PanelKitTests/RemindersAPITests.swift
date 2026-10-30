import Foundation
import XCTest
@testable import PanelKit

final class RemindersAPITests: XCTestCase {
    func testSyntheticSnapshotPreservesIdentityAndWriteAccess() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "incomplete", withExtension: "json", subdirectory: "Fixtures/reminders"))
        let rows = try JSONDecoder().decode([PanelReminder].self, from: Data(contentsOf: url))
        XCTAssertEqual(rows.map(\.id), ["fixture_one", "fixture_readonly"])
        XCTAssertEqual(rows.map(\.writable), [true, false])
    }
}
