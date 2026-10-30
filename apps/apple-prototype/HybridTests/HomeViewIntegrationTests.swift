import XCTest
import UIKit
@testable import Panel

@MainActor final class HomeViewIntegrationTests: XCTestCase {
    func testEveryHomeTileMapsToAnExistingProviderAndController() {
        XCTAssertEqual(HomeTile.panelProviders, Set(PanelModule.allCases).subtracting([.all, .reminders]))
        for tile in HomeTile.allCases {
            XCTAssertNotEqual(tile.panelModule, .all, tile.rawValue)
            XCTAssertNotEqual(tile.panelModule, .reminders, tile.rawValue)
        }
        XCTAssertEqual(HomeTile.clock.panelModule, .alarms)
        XCTAssertEqual(HomeTile.all.panelModule, .lights)
        XCTAssertEqual(HomeTile.sonosRooms.panelModule, .sonos)
    }

    func testHomeWallpaperAndSkyAreInPanelBundle() {
        XCTAssertNotNil(UIImage(named: "LakeWallpaper"))
        XCTAssertNotNil(UIImage(named: "CloudPhoto"))
        XCTAssertNil(UIImage(named: "ForestPhoto"))
        XCTAssertNil(UIImage(named: "CoastPhoto"))
    }
}
