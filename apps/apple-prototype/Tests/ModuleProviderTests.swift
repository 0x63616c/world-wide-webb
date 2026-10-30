import XCTest
import UIKit
@testable import WorldWideWebb

@MainActor final class ModuleProviderTests: XCTestCase {
    func testMediaPlayTargetsTheCoordinatorGroupAndResetsPosition() {
        let store = MockHomeDataSource(fixedNow: Date(timeIntervalSince1970: 1_793_292_630))
        store.send(.playMedia("Living Room", 2))
        for room in store.rooms where room.coordinator == "Desk" {
            XCTAssertEqual(room.trackIndex, 2)
            XCTAssertTrue(room.playing)
            XCTAssertEqual(room.position(at: store.now), 0)
            XCTAssertEqual(room.sourceLabel, "Fixture library")
        }
        XCTAssertEqual(store.rooms.first { $0.id == "Bedroom" }?.trackIndex, 0)
        XCTAssertFalse(store.rooms.first { $0.id == "Bedroom" }!.playing)
        store.send(.playMedia("Living Room", 99))
        XCTAssertEqual(store.rooms.first!.trackIndex, 2)
    }
    func testCalendarChoosesOngoingOrNextEventAndEndsTheDay() {
        let provider = MockCalendarProvider()
        let parser = ISO8601DateFormatter()
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T17:10:30Z")!)?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T18:30:00Z")!)?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: parser.date(from: "2026-10-29T19:30:00Z")!)?.title, "Lunch break")
        XCTAssertNil(provider.next(at: parser.date(from: "2026-10-30T02:00:00Z")!))
    }
    func testBundledFilmAndPhotoFixturesAreAvailableOffline() {
        XCTAssertNotNil(MockMediaProvider().videoURL)
        XCTAssertEqual(MockPhotosProvider().photos.count, 3)
        XCTAssertEqual(MockCamerasProvider().feeds.count, 2)
        for photo in MockPhotosProvider().photos { XCTAssertNotNil(UIImage(named: photo.asset)) }
    }
}
