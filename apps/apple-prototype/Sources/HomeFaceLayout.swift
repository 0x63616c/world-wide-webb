import Foundation

/// The live faces and geometry tests consume these exact frames. Coordinates are
/// local to the safe viewport; phone content can be taller than that viewport.
struct HomeFaceLayout {
    struct Item: Identifiable {
        let tile: HomeTile
        let frame: CGRect
        let round: Bool
        var id: String { tile.id }
    }
    let items: [Item]
    let contentSize: CGSize
    let header: CGRect
    let gutter: CGFloat
    let margin: CGFloat
    let pagerBand: CGFloat
    let viewport: CGSize

    static let panelPagerBand: CGFloat = 80
    static let phonePagerBand: CGFloat = 64

    static func panel(in size: CGSize) -> Self {
        let gap: CGFloat = 24, minimumMargin: CGFloat = 48
        let heading: CGFloat = 48, headingGap: CGFloat = 24
        // A 16-point cell also keeps the centered five-column grid on 8 points.
        let cell = floor(min((size.width - 2 * minimumMargin - 4 * gap) / 5,
                             (size.height - 2 * minimumMargin - heading - headingGap - panelPagerBand - 2 * gap) / 3) / 16) * 16
        let width = cell * 5 + gap * 4, height = cell * 3 + gap * 2
        let left = (size.width - width) / 2
        let top = (size.height - panelPagerBand - heading - headingGap - height) / 2
        let items = HomeTile.homeFace.map { tile in
            let c = MixedHomeLayout.cells(tile)
            return Item(tile: tile, frame: CGRect(x: left + CGFloat(c.x) * (cell + gap),
                                                  y: top + heading + headingGap + CGFloat(c.y) * (cell + gap),
                                                  width: cell * CGFloat(c.w) + gap * CGFloat(c.w - 1),
                                                  height: cell * CGFloat(c.h) + gap * CGFloat(c.h - 1)),
                        round: c.w == 1 && c.h == 1)
        }
        return Self(items: items, contentSize: size,
                    header: CGRect(x: left, y: top, width: width, height: heading),
                    gutter: gap, margin: minimumMargin, pagerBand: panelPagerBand, viewport: size)
    }

    /// `size` already excludes hardware safe areas, but includes the pager band.
    static func phone(in size: CGSize, controls: Bool = false) -> Self {
        let gap: CGFloat = 16, margin: CGFloat = 24
        let cell = floor((size.width - 2 * margin - gap) / 2 / 8) * 8
        let width = cell * 2 + gap, left = (size.width - width) / 2
        let header = CGRect(x: left, y: margin, width: width, height: 40)
        var items: [Item] = []
        var y = header.maxY + gap
        func add(_ tile: HomeTile, x: CGFloat = 0, width: CGFloat, height: CGFloat, round: Bool = false) {
            items.append(Item(tile: tile, frame: CGRect(x: left + x, y: y, width: width, height: height), round: round))
        }
        add(.climate, width: width, height: 264)
        y += 264 + gap
        add(.lamps, width: cell, height: 2 * cell + gap)
        add(controls ? .cabinet : .ceiling, x: cell + gap, width: cell, height: cell, round: true)
        y += cell + gap
        add(.fan, x: cell + gap, width: cell, height: cell, round: true)
        y += cell + gap
        add(.sound, width: width, height: 136)
        y += 136 + gap
        add(.tesla, width: width, height: 152)
        y += 152 + gap
        add(.clock, width: cell, height: cell, round: true)
        add(.wifi, x: cell + gap, width: cell, height: cell, round: true)
        let height = y + cell + margin
        return Self(items: items, contentSize: CGSize(width: size.width, height: height), header: header,
                    gutter: gap, margin: margin, pagerBand: phonePagerBand, viewport: size)
    }

    /// Frames at either end of the phone scroll range, used to test the last row
    /// against the fixed page controls rather than merely the content rectangle.
    var bottomScrollOffset: CGFloat { max(0, contentSize.height - (viewport.height - pagerBand)) }
}
