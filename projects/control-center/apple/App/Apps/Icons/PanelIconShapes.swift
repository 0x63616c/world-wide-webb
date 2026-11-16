import SwiftUI

/// Authored on a 1,000-unit artboard, then scaled at the final display size.
/// These are the approved silhouettes, not font glyphs or raster mockups.
enum PanelIconShape: Shape {
    case cloud, bulb, hill

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch self {
        case .cloud:
            // Three lobes on a flat base; the valleys between them are filleted.
            path.move(to: CGPoint(x: 317.9, y: 763.8))
            path.addArc(
                center: CGPoint(x: 317.9, y: 648.0), radius: 115.7,
                startAngle: .degrees(90), endAngle: .degrees(-111.3), clockwise: false)
            path.addArc(
                center: CGPoint(x: 250.2, y: 474.6), radius: 70.5,
                startAngle: .degrees(68.7), endAngle: .degrees(18.8), clockwise: true)
            path.addArc(
                center: CGPoint(x: 478.9, y: 552.4), radius: 171.1,
                startAngle: .degrees(-161.2), endAngle: .degrees(-28.1), clockwise: false)
            path.addArc(
                center: CGPoint(x: 691.9, y: 438.5), radius: 70.5,
                startAngle: .degrees(151.9), endAngle: .degrees(105), clockwise: true)
            path.addArc(
                center: CGPoint(x: 639.9, y: 633.0), radius: 130.8,
                startAngle: .degrees(-75), endAngle: .degrees(90), clockwise: false)
            path.closeSubpath()
        case .bulb:
            path.move(to: CGPoint(x: 400, y: 680))
            path.addCurve(
                to: CGPoint(x: 365, y: 588), control1: CGPoint(x: 373, y: 680), control2: CGPoint(x: 387, y: 630))
            path.addCurve(
                to: CGPoint(x: 256, y: 384), control1: CGPoint(x: 319, y: 531), control2: CGPoint(x: 256, y: 476))
            path.addCurve(
                to: CGPoint(x: 499, y: 152), control1: CGPoint(x: 256, y: 253), control2: CGPoint(x: 365, y: 152))
            path.addCurve(
                to: CGPoint(x: 742, y: 384), control1: CGPoint(x: 633, y: 152), control2: CGPoint(x: 742, y: 253))
            path.addCurve(
                to: CGPoint(x: 633, y: 588), control1: CGPoint(x: 742, y: 476), control2: CGPoint(x: 679, y: 531))
            path.addCurve(
                to: CGPoint(x: 598, y: 680), control1: CGPoint(x: 611, y: 630), control2: CGPoint(x: 625, y: 680))
            path.closeSubpath()
        case .hill:
            path.move(to: CGPoint(x: 0, y: 630))
            path.addCurve(
                to: CGPoint(x: 1000, y: 745), control1: CGPoint(x: 430, y: 345), control2: CGPoint(x: 620, y: 825))
            path.addLine(to: CGPoint(x: 1000, y: 1000))
            path.addLine(to: CGPoint(x: 0, y: 1000))
            path.closeSubpath()
        }
        return path.applying(
            CGAffineTransform(scaleX: rect.width / 1000, y: rect.height / 1000)
                .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}
