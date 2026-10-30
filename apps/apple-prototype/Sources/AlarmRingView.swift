import SwiftUI

struct AlarmRingView: View {
    let store: any HomeDataSource
    let close: () -> Void
    let edit: () -> Void
    private let orange = Color.orange
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let now = store.now
            let next = store.upcomingAlarm(at: now)
            GeometryReader { proxy in
                ZStack {
                    Color.black
                    AlarmTicks(fraction: next?.ringFraction(at: now) ?? 0, ringing: next?.ringing ?? false)
                        .background {
                            ContainerRelativeShape().stroke(orange.opacity(0.045), lineWidth: 1)
                        }
                        .padding(AlarmPerimeter.edgeInset)
                    VStack(spacing: 22) {
                        Text(next?.ringing == true ? "Alarm" : next?.snoozed == true ? "Snoozed" : "Next alarm")
                            .font(.system(size: 28, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                        Text(next.map { countdown($0.remaining(at: now)) } ?? "—")
                            .font(.system(size: min(proxy.size.width * 0.13, 176), weight: .regular, design: .rounded)).monospacedDigit().fontWidth(.condensed)
                            .contentTransition(.numericText())
                        Text(next.map { "\($0.alarm.label.uppercased()) · \($0.alarm.time)" } ?? "NO UPCOMING ALARMS")
                            .font(.system(size: 34, weight: .medium)).foregroundStyle(orange)
                        if let next, next.ringing, let version = next.version {
                            HStack(spacing: 24) {
                                if let minutes = Int(next.alarm.snoozeMinutes), minutes > 0 {
                                    Button("Snooze · \(minutes) min") { store.send(.snoozeAlarm(next.alarm.id, version)) }
                                        .padding(18).buttonStyle(.glass)
                                }
                                Button("Stop") { store.send(.stopAlarm(next.alarm.id, version)) }
                                    .padding(18).buttonStyle(.glass)
                            }.font(.system(size: 28, weight: .semibold)).padding(.top, 30)
                        } else if next == nil {
                            Button("Set an alarm", action: edit).font(.system(size: 26, weight: .semibold)).buttonStyle(.glass).padding(.top, 30)
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    HStack {
                        CircleButton(symbol: "xmark", label: "Close alarm", size: 64, action: close).accessibilityIdentifier("close-controller")
                        Spacer()
                        Button("Alarms", systemImage: "alarm", action: edit)
                            .font(.system(size: 22, weight: .medium)).buttonStyle(.glass)
                    }.frame(maxHeight: .infinity, alignment: .top).padding(74)
                    Text("Fixture data").font(.system(size: 12)).opacity(0.4)
                        .position(x: proxy.size.width / 2, y: proxy.size.height - 22)
                }.containerShape(.rect(cornerRadius: AlarmPerimeter.faceCornerRadius, style: .circular))
            }
        }.foregroundStyle(.white).tint(orange).ignoresSafeArea()
    }
    private func countdown(_ interval: TimeInterval) -> String {
        let total = max(0, Int(ceil(interval)))
        if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

private struct AlarmTicks: View {
    let fraction: Double
    let ringing: Bool
    var body: some View {
        Canvas { context, size in
            let perimeter = AlarmPerimeter(size: size)
            let tickCount = 120
            for tick in 0..<tickCount {
                let progress = Double(tick) / Double(tickCount)
                let sample = perimeter.sample(at: perimeter.length * progress)
                let outer = sample.point
                let tickLength: CGFloat = tick.isMultiple(of: 5) ? 28 : 16
                let inner = CGPoint(x: outer.x - sample.normal.dx * tickLength,
                                    y: outer.y - sample.normal.dy * tickLength)
                var path = Path(); path.move(to: inner); path.addLine(to: outer)
                let active = ringing || progress < min(1, max(0, fraction))
                context.stroke(path, with: .color(Color.orange.opacity(active ? 1 : 0.19)), style: StrokeStyle(lineWidth: 4, lineCap: .round))
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
    var radius: CGFloat { min(Self.faceCornerRadius - Self.edgeInset, min(size.width, size.height) / 2) }
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
