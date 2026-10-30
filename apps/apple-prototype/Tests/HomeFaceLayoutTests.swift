import XCTest
@testable import WorldWideWebb

final class HomeFaceLayoutTests: XCTestCase {
    func testPanelHasEqualGuttersAndSafeMarginsAbovePager() {
        for controls in [false, true] {
        let layout = HomeFaceLayout.panel(in: CGSize(width: 1376, height: 1032), controls: controls)
        checkFrames(layout)
        let lastEdge = layout.items.map(\.frame.maxY).max()!
        let bottomMargin = layout.viewport.height - layout.pagerBand - lastEdge
        XCTAssertEqual(bottomMargin, layout.header.minY, accuracy: 0.5)
        XCTAssertEqual(bottomMargin, layout.header.minX, accuracy: 0.5)
        for item in layout.items {
            XCTAssertLessThanOrEqual(item.frame.maxY, layout.viewport.height - layout.pagerBand - layout.margin)
            XCTAssertEqual(item.frame.minX.truncatingRemainder(dividingBy: 8), 0, accuracy: 0.5)
            XCTAssertEqual(item.frame.minY.truncatingRemainder(dividingBy: 8), 0, accuracy: 0.5)
        }
        XCTAssertEqual(layout.items.filter(\.round).count, 3)
        }
    }

    func testPhoneScrollEndsWithLastRowClearOfPageBand() {
        // iPhone 17 Pro: 402x874, safe top 62 and bottom 34. Include the
        // fixed pager in the solver viewport, matching the live safeAreaInset.
        for width: CGFloat in [375, 390, 402, 430] {
            for controls in [false, true] {
                let layout = HomeFaceLayout.phone(in: CGSize(width: width, height: 778), controls: controls)
                checkFrames(layout)
                let lastRow = layout.items.filter { $0.tile == .all || $0.tile == .cabinet }
                for item in lastRow {
                    let visible = item.frame.offsetBy(dx: 0, dy: -layout.bottomScrollOffset)
                    XCTAssertGreaterThanOrEqual(visible.minY, layout.margin)
                    let gapToPager = layout.viewport.height - layout.pagerBand - visible.maxY
                    XCTAssertEqual(gapToPager, layout.margin, accuracy: 0.5)
                    XCTAssertEqual(gapToPager, layout.header.minY, accuracy: 0.5)
                }
            }
        }
    }

    func testPhoneBottomShowsTheWholeMusicCardAboveTheRoundControls() {
        let layout = HomeFaceLayout.phone(in: CGSize(width: 402, height: 778))
        let music = layout.items.first { $0.tile == .sound }!
        let visible = music.frame.offsetBy(dx: 0, dy: -layout.bottomScrollOffset)
        XCTAssertGreaterThanOrEqual(visible.minY, layout.margin)
        XCTAssertLessThanOrEqual(visible.maxY, layout.viewport.height - layout.pagerBand - layout.margin)
        // A preceding tile may end in the mask's clear 4-pt strip, but must
        // never leave an isolated glass rim in the visible fade.
        let previousBottom = layout.items.filter { $0.frame.maxY < music.frame.minY }
            .map { $0.frame.maxY - layout.bottomScrollOffset }.max()!
        XCTAssertLessThanOrEqual(previousBottom, 4)
    }

    func testPhoneBottomRemovesOffscreenGlassWithoutMovingVisibleCards() {
        let layout = HomeFaceLayout.phone(in: CGSize(width: 402, height: 778))
        let viewport = CGRect(x: 0, y: layout.bottomScrollOffset, width: 402, height: 698)
        let visible = layout.visibleTiles(in: viewport)
        XCTAssertEqual(visible, [.sound, .tesla, .clock, .wifi, .all, .cabinet])
        XCTAssertFalse(visible.contains(.lamps))
        XCTAssertFalse(visible.contains(.fan))
    }

    func testPhoneFirstViewportIncludesClimateWeatherAndAgenda() {
        let layout = HomeFaceLayout.phone(in: CGSize(width: 402, height: 778))
        for tile in [HomeTile.climate, .weather, .calendar] {
            let frame = layout.items.first { $0.tile == tile }!.frame
            XCTAssertLessThanOrEqual(frame.maxY, layout.viewport.height - layout.pagerBand - layout.margin)
        }
    }

    func testEveryModuleAndAccessoryIsReachableOnBothDeviceLayouts() {
        let required: Set<HomeTile> = [.climate, .lamps, .weather, .calendar, .sound, .tesla, .fan,
                                       .cameras, .photos, .media, .sonosRooms, .dogwalk, .clock, .ceiling, .cabinet, .wifi, .all]
        let size = CGSize(width: 1376, height: 1032)
        let panel = [false, true].flatMap { HomeFaceLayout.panel(in: size, controls: $0).items.map(\.tile) }
        let phone = [false, true].flatMap { HomeFaceLayout.phone(in: CGSize(width: 402, height: 778), controls: $0).items.map(\.tile) }
        XCTAssertEqual(Set(panel), required)
        XCTAssertEqual(Set(phone), required)
        // Quick-access duplicates across pages are intentional; identity is unique
        // within each face and the same provider backs both presentations.
        for controls in [false, true] {
            let tiles = HomeFaceLayout.panel(in: size, controls: controls).items.map(\.tile)
            XCTAssertEqual(tiles.count, Set(tiles).count)
        }
    }

    private func checkFrames(_ layout: HomeFaceLayout, file: StaticString = #filePath, line: UInt = #line) {
        let frames = layout.items.map(\.frame)
        for (index, item) in layout.items.enumerated() {
            let a = item.frame
            XCTAssertGreaterThanOrEqual(a.minX, layout.margin, file: file, line: line)
            XCTAssertLessThanOrEqual(a.maxX, layout.contentSize.width - layout.margin, file: file, line: line)
            XCTAssertGreaterThanOrEqual(a.minY, layout.header.maxY + layout.gutter, file: file, line: line)
            XCTAssertLessThanOrEqual(a.maxY, layout.contentSize.height - layout.margin, file: file, line: line)
            if item.round { XCTAssertEqual(a.width, a.height, accuracy: 0.5, file: file, line: line) }
            for b in frames.dropFirst(index + 1) {
                XCTAssertFalse(a.intersects(b), "Overlapping tile frames: \(a), \(b)", file: file, line: line)
            }
            // The nearest neighbour along each occupied row/column must have
            // exactly the declared gutter, regardless of mixed tile spans.
            let right = frames.filter { $0.minX >= a.maxX && min(a.maxY, $0.maxY) > max(a.minY, $0.minY) }
            if let edge = right.map(\.minX).min() {
                XCTAssertEqual(edge - a.maxX, layout.gutter, accuracy: 0.5, file: file, line: line)
            }
            let below = frames.filter { $0.minY >= a.maxY && min(a.maxX, $0.maxX) > max(a.minX, $0.minX) }
            if let edge = below.map(\.minY).min() {
                XCTAssertEqual(edge - a.maxY, layout.gutter, accuracy: 0.5, file: file, line: line)
            }
        }
    }
}
