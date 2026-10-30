import SwiftUI

struct AlarmRingView: View {
    let store: any HomeDataSource
    let close: () -> Void
    let edit: () -> Void
    private let orange = Color(hex: "#ff9f24")
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let now = store.now
            let next = store.upcomingAlarm(at: now)
            GeometryReader { proxy in
                ZStack {
                    Color.black
                    AlarmTicks(fraction: next?.ringFraction(at: now) ?? 0, ringing: next?.ringing ?? false)
                        .padding(.horizontal, 88).padding(.vertical, 80)
                    VStack(spacing: 22) {
                        Text(next?.ringing == true ? "Alarm" : next?.snoozed == true ? "Snoozed" : "Next alarm")
                            .font(.system(size: 28, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                        Text(next.map { countdown($0.remaining(at: now)) } ?? "—")
                            .font(.system(size: 190, weight: .light)).monospacedDigit().tracking(-5)
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
                    }.frame(maxHeight: .infinity, alignment: .top).padding(32)
                    Text("Fixture data").font(.system(size: 12)).opacity(0.4)
                        .position(x: proxy.size.width / 2, y: proxy.size.height - 22)
                }
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
            // Sample the superellipse by arc length so the ticks stay evenly spaced.
            let a = size.width / 2 - 5, b = size.height / 2 - 5
            let samples: [CGPoint] = (0...2400).map { index in
                let angle = Double(index) / 2400 * 2 * .pi - .pi / 2
                return CGPoint(x: a * copysign(pow(abs(cos(angle)), 0.5), cos(angle)),
                               y: b * copysign(pow(abs(sin(angle)), 0.5), sin(angle)))
            }
            var distances = [CGFloat](repeating: 0, count: samples.count)
            for i in 1..<samples.count {
                distances[i] = distances[i - 1] + hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)
            }
            let perimeter = distances.last!
            var index = 1
            for tick in 0..<80 {
                let distance = perimeter * Double(tick) / 80
                while index < samples.count - 1 && distances[index] < distance { index += 1 }
                let span = distances[index] - distances[index - 1]
                let t = span > 0 ? (distance - distances[index - 1]) / span : 0
                let p = CGPoint(x: samples[index - 1].x + (samples[index].x - samples[index - 1].x) * t,
                                y: samples[index - 1].y + (samples[index].y - samples[index - 1].y) * t)
                // The gradient of x^4/a^4 + y^4/b^4 gives the true outward normal.
                let nx = pow(p.x / a, 3) / a, ny = pow(p.y / b, 3) / b
                let length = hypot(nx, ny)
                let outer = CGPoint(x: size.width / 2 + p.x, y: size.height / 2 + p.y)
                let inner = CGPoint(x: outer.x - nx / length * 30, y: outer.y - ny / length * 30)
                var path = Path(); path.move(to: inner); path.addLine(to: outer)
                let active = ringing || Double(tick) / 80 < fraction
                context.stroke(path, with: .color(Color(hex: "#ff9f24").opacity(active ? 1 : 0.19)), style: StrokeStyle(lineWidth: 7, lineCap: .round))
            }
        }.accessibilityHidden(true)
    }
}
