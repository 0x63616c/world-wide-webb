import UIKit
import XCTest

@testable import Panel

@MainActor final class ModuleProviderTests: XCTestCase {
    func testCalendarChoosesOngoingOrNextEventAndEndsTheDay() {
        let provider = MockCalendarProvider()
        let parser = ISO8601DateFormatter()
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T17:10:30Z")!)?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T18:30:00Z")!)?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T19:30:00Z")!)?.title, "Lunch break")
        XCTAssertNil(provider.next(at: parser.date(from: "2026-10-30T02:00:00Z")!))
    }
    func testBundledFilmAndPhotoFixturesAreAvailableOffline() {
        XCTAssertEqual(MockPhotosProvider().photos.count, 3)
        for photo in MockPhotosProvider().photos { XCTAssertNotNil(UIImage(named: photo.asset)) }
    }
}
