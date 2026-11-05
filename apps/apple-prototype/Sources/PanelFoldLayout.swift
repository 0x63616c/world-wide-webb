import SwiftUI

/// Keep a compact group of essential controls together, using the active fold
/// reported in this view's coordinates. Decorative content can still span it.
enum PanelFoldLayout {
    static func controlFrame(in proxy: GeometryProxy) -> CGRect {
        let bounds = CGRect(origin: .zero, size: proxy.size)
        #if os(iOS)
        if #available(iOS 27.1, *) {
            return usableFrame(in: bounds, avoiding: proxy.reservedRegions(kind: .division,
                layoutDirectionBehavior: .fixed).filter(\.isActive).map(\.frame))
        }
        #endif
        return bounds
    }

    static func usableFrame(in bounds: CGRect, avoiding divisions: [CGRect]) -> CGRect {
        divisions.reduce(bounds) { area, division in
            let cut = area.intersection(division)
            guard !cut.isNull, !cut.isEmpty else { return area }
            let candidates: [CGRect]
            if cut.height > cut.width {
                candidates = [CGRect(x: area.minX, y: area.minY, width: cut.minX - area.minX, height: area.height),
                              CGRect(x: cut.maxX, y: area.minY, width: area.maxX - cut.maxX, height: area.height)]
            } else {
                candidates = [CGRect(x: area.minX, y: area.minY, width: area.width, height: cut.minY - area.minY),
                              CGRect(x: area.minX, y: cut.maxY, width: area.width, height: area.maxY - cut.maxY)]
            }
            return candidates.max { $0.width * $0.height < $1.width * $1.height } ?? area
        }
    }
}
