import SwiftUI

/// Shared perimeter for the alarm and timer faces.
struct CountdownTicks: View {
    let fraction: Double
    let ringing: Bool
    var tickLength: CGFloat? = nil
    var lineWidth: CGFloat = 4
    var cornerRadius: CGFloat? = nil
    var body: some View {
        Canvas { context, size in
            let perimeter = AlarmPerimeter(size: CGSize(width: size.width - 6, height: size.height - 6), cornerRadius: cornerRadius)
            let tickCount = 120
            for tick in 0..<tickCount {
                let progress = Double(tick) / Double(tickCount)
                let sample = perimeter.sample(at: perimeter.length * progress)
                let outer = CGPoint(x: sample.point.x + 3, y: sample.point.y + 3)
                let length: CGFloat = tickLength ?? (tick.isMultiple(of: 5) ? 28 : 16)
                let inner = CGPoint(x: outer.x - sample.normal.dx * length,
                                    y: outer.y - sample.normal.dy * length)
                var path = Path(); path.move(to: inner); path.addLine(to: outer)
                let active = ringing || progress < min(1, max(0, fraction))
                context.stroke(path, with: .color(Color.orange.opacity(active ? 1 : 0.19)), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            }
        }.accessibilityHidden(true)
    }
}

// Exact arc-length sampler: four straight edges and four circular corners.
// The contour is concentric with the explicit display container above; progress
// starts at top centre and travels clockwise, including through every corner.
struct AlarmPerimeter {
    // Reported earlier iPad measurement; 13-inch value is not publicly verified.
    // https://github.com/kylebshr/ScreenCorners
    static let reportedIPadCornerRadius: CGFloat = 18
    // Deliberate rounded FACE boundary from calum_4, not a hardware claim.
    static let faceCornerRadius: CGFloat = 112
    static let edgeInset: CGFloat = 32
    let size: CGSize
    var cornerRadius: CGFloat? = nil
    var radius: CGFloat { min(cornerRadius ?? (Self.faceCornerRadius - Self.edgeInset), min(size.width, size.height) / 2) }
    var length: CGFloat { 2 * (size.width + size.height - 4 * radius) + 2 * .pi * radius }

    struct Sample {
        let point: CGPoint
        let normal: CGVector
    }

    func sample(at distance: CGFloat) -> Sample {
        let r = radius, w = size.width, h = size.height
        let horizontal = w - 2 * r, vertical = h - 2 * r
        let arc = .pi * r / 2
        var remaining = (distance.truncatingRemainder(dividingBy: length) + length).truncatingRemainder(dividingBy: length)
        let lengths = [horizontal / 2, arc, vertical, arc, horizontal, arc, vertical, arc, horizontal / 2]
        for (index, segment) in lengths.enumerated() {
            if remaining <= segment {
                switch index {
                case 0: return Sample(point: CGPoint(x: w / 2 + remaining, y: 0), normal: CGVector(dx: 0, dy: -1))
                case 2: return Sample(point: CGPoint(x: w, y: r + remaining), normal: CGVector(dx: 1, dy: 0))
                case 4: return Sample(point: CGPoint(x: w - r - remaining, y: h), normal: CGVector(dx: 0, dy: 1))
                case 6: return Sample(point: CGPoint(x: 0, y: h - r - remaining), normal: CGVector(dx: -1, dy: 0))
                case 8: return Sample(point: CGPoint(x: r + remaining, y: 0), normal: CGVector(dx: 0, dy: -1))
                default:
                    let corner = (index - 1) / 2
                    let centres = [CGPoint(x: w - r, y: r), CGPoint(x: w - r, y: h - r),
                                   CGPoint(x: r, y: h - r), CGPoint(x: r, y: r)]
                    let angle = CGFloat(corner - 1) * .pi / 2 + remaining / r
                    let normal = CGVector(dx: cos(angle), dy: sin(angle))
                    return Sample(point: CGPoint(x: centres[corner].x + normal.dx * r,
                                                 y: centres[corner].y + normal.dy * r), normal: normal)
                }
            }
            remaining -= segment
        }
        return Sample(point: CGPoint(x: w / 2, y: 0), normal: CGVector(dx: 0, dy: -1))
    }
}
