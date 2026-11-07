import SwiftUI

/// The fill always represents charge; only its light moves.
struct TeslaChargeBar: View {
    let percent: Int
    let active: Bool
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var fixedPhase

    private var animating: Bool {
        active && !reduceMotion && fixedPhase == nil && scenePhase == .active
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animating)) { timeline in
            let phase = reduceMotion ? 0.5 : (fixedPhase ?? timeline.date.timeIntervalSinceReferenceDate)
                .truncatingRemainder(dividingBy: 3.6) / 3.6
            let glow = animating ? 0.25 + 0.15 * sin(phase * .pi * 2) : 0.3
            GeometryReader { proxy in
                let fill = proxy.size.width * Double(min(100, max(0, percent))) / 100
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(tint)
                        .frame(width: fill)
                        .overlay {
                            if active && !reduceMotion {
                                LinearGradient(colors: [.clear, .white.opacity(0.65), .clear],
                                               startPoint: .leading, endPoint: .trailing)
                                    .frame(width: 90)
                                    .position(x: (fill + 90) * phase - 45, y: 5)
                                    .mask(Capsule().frame(width: fill))
                            }
                        }
                        .shadow(color: active ? .green.opacity(glow) : .clear, radius: 8)
                }
            }
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}
