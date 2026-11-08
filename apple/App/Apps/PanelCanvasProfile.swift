import CoreGraphics

/// The three supported compositions, in points. Duo sizes come from Xcode's
/// device displays (1398×2034 and 2853×2007 pixels at 3×); the iPad is the
/// household's landscape 12.9-inch Pro. Intermediate proposals never resize type.
enum PanelCanvasProfile: String, CaseIterable {
    case iPad, duoClosed, duoOpen

    var size: CGSize {
        switch self {
        case .iPad: CGSize(width: 1366, height: 1024)
        case .duoClosed: CGSize(width: 466, height: 678)
        case .duoOpen: CGSize(width: 951, height: 669)
        }
    }

    static func resolve(size: CGSize) -> Self {
        if max(size.width, size.height) >= 1100 { return .iPad }
        return min(size.width, size.height) >= 600 ? .duoOpen : .duoClosed
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

    init(profile: PanelCanvasProfile) {
        switch profile {
        case .iPad:
            columns = 5
            iconFrameSide = 112
            horizontalInset = 72
            headerInset = 40
            labelSize = 21
            rowSpacing = 48
        case .duoClosed:
            columns = 3
            iconFrameSide = 76
            horizontalInset = 20
            headerInset = 20
            labelSize = 15
            rowSpacing = 32
        case .duoOpen:
            columns = 5
            iconFrameSide = 96
            horizontalInset = 36
            headerInset = 24
            labelSize = 18
            rowSpacing = 36
        }
    }
}
