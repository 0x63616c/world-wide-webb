import CoreGraphics

/// Presentation density follows the proposed width, never a particular device
/// or a fixed physical display size. Canvas dimensions always come from the view.
enum PanelCanvasProfile: String, CaseIterable {
    case spacious, compact, regular

    static func resolve(size: CGSize) -> Self {
        if size.width >= 1100 { return .spacious }
        return size.width >= 600 ? .regular : .compact
    }
}

/// Deliberate launcher composition for each supported canvas.
struct LauncherLayout {
    let columns: Int
    let iconFrameSide: CGFloat
    let horizontalInset: CGFloat
    let headerInset: CGFloat
    let labelSize: CGFloat
    let rowSpacing: CGFloat

    init(profile: PanelCanvasProfile, availableWidth: CGFloat) {
        let preferredColumns: Int
        switch profile {
        case .spacious:
            preferredColumns = 5
            iconFrameSide = 112
            horizontalInset = 72
            headerInset = 40
            labelSize = 21
            rowSpacing = 48
        case .compact:
            preferredColumns = 3
            iconFrameSide = 76
            horizontalInset = 20
            headerInset = 20
            labelSize = 15
            rowSpacing = 32
        case .regular:
            preferredColumns = 5
            iconFrameSide = 96
            horizontalInset = 36
            headerInset = 24
            labelSize = 18
            rowSpacing = 36
        }
        let columnWidth = max(iconFrameSide, labelSize * 6)
        let fittingColumns = Int(max(0, availableWidth - horizontalInset * 2 + 28) / (columnWidth + 28))
        columns = min(preferredColumns, max(1, fittingColumns))
    }
}
