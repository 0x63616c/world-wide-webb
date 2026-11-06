import SwiftUI

/// Authored on a 1,000-unit artboard, then scaled at the final display size.
/// These are the approved silhouettes, not font glyphs or raster mockups.
enum PanelIconShape: Shape {
    case cloud, bulb, musicNotes, hill

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch self {
        case .cloud:
            path.move(to: CGPoint(x: 314, y: 748))
            path.addCurve(to: CGPoint(x: 203, y: 646), control1: CGPoint(x: 249, y: 748), control2: CGPoint(x: 203, y: 708))
            path.addCurve(to: CGPoint(x: 310, y: 535), control1: CGPoint(x: 203, y: 584), control2: CGPoint(x: 250, y: 535))
            path.addCurve(to: CGPoint(x: 372, y: 550), control1: CGPoint(x: 334, y: 535), control2: CGPoint(x: 354, y: 540))
            path.addCurve(to: CGPoint(x: 603, y: 368), control1: CGPoint(x: 407, y: 437), control2: CGPoint(x: 491, y: 368))
            path.addCurve(to: CGPoint(x: 828, y: 570), control1: CGPoint(x: 727, y: 368), control2: CGPoint(x: 828, y: 450))
            path.addCurve(to: CGPoint(x: 638, y: 748), control1: CGPoint(x: 828, y: 675), control2: CGPoint(x: 751, y: 748))
            path.closeSubpath()
        case .bulb:
            path.move(to: CGPoint(x: 400, y: 680))
            path.addCurve(to: CGPoint(x: 365, y: 588), control1: CGPoint(x: 373, y: 680), control2: CGPoint(x: 387, y: 630))
            path.addCurve(to: CGPoint(x: 256, y: 384), control1: CGPoint(x: 319, y: 531), control2: CGPoint(x: 256, y: 476))
            path.addCurve(to: CGPoint(x: 499, y: 152), control1: CGPoint(x: 256, y: 253), control2: CGPoint(x: 365, y: 152))
            path.addCurve(to: CGPoint(x: 742, y: 384), control1: CGPoint(x: 633, y: 152), control2: CGPoint(x: 742, y: 253))
            path.addCurve(to: CGPoint(x: 633, y: 588), control1: CGPoint(x: 742, y: 476), control2: CGPoint(x: 679, y: 531))
            path.addCurve(to: CGPoint(x: 598, y: 680), control1: CGPoint(x: 611, y: 630), control2: CGPoint(x: 625, y: 680))
            path.closeSubpath()
        case .musicNotes:
            path.move(to: CGPoint(x: 388, y: 590))
            path.addLine(to: CGPoint(x: 388, y: 390))
            path.addCurve(to: CGPoint(x: 433, y: 322), control1: CGPoint(x: 388, y: 355), control2: CGPoint(x: 402, y: 333))
            path.addLine(to: CGPoint(x: 746, y: 226))
            path.addCurve(to: CGPoint(x: 803, y: 262), control1: CGPoint(x: 781, y: 215), control2: CGPoint(x: 803, y: 231))
            path.addLine(to: CGPoint(x: 803, y: 626))
            path.addCurve(to: CGPoint(x: 684, y: 738), control1: CGPoint(x: 803, y: 685), control2: CGPoint(x: 752, y: 738))
            path.addCurve(to: CGPoint(x: 548, y: 646), control1: CGPoint(x: 626, y: 738), control2: CGPoint(x: 548, y: 705))
            path.addCurve(to: CGPoint(x: 668, y: 528), control1: CGPoint(x: 548, y: 590), control2: CGPoint(x: 603, y: 528))
            path.addCurve(to: CGPoint(x: 749, y: 547), control1: CGPoint(x: 700, y: 528), control2: CGPoint(x: 729, y: 535))
            path.addLine(to: CGPoint(x: 749, y: 363))
            path.addLine(to: CGPoint(x: 444, y: 457))
            path.addLine(to: CGPoint(x: 444, y: 672))
            path.addCurve(to: CGPoint(x: 324, y: 792), control1: CGPoint(x: 444, y: 731), control2: CGPoint(x: 391, y: 790))
            path.addCurve(to: CGPoint(x: 188, y: 711), control1: CGPoint(x: 270, y: 793), control2: CGPoint(x: 188, y: 764))
            path.addCurve(to: CGPoint(x: 315, y: 580), control1: CGPoint(x: 188, y: 653), control2: CGPoint(x: 247, y: 580))
            path.addCurve(to: CGPoint(x: 388, y: 590), control1: CGPoint(x: 341, y: 580), control2: CGPoint(x: 365, y: 584))
            path.closeSubpath()
        case .hill:
            path.move(to: CGPoint(x: 0, y: 630))
            path.addCurve(to: CGPoint(x: 1000, y: 745), control1: CGPoint(x: 430, y: 345), control2: CGPoint(x: 620, y: 825))
            path.addLine(to: CGPoint(x: 1000, y: 1000))
            path.addLine(to: CGPoint(x: 0, y: 1000))
            path.closeSubpath()
        }
        return path.applying(CGAffineTransform(scaleX: rect.width / 1000, y: rect.height / 1000)
            .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}
