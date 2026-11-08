import SwiftUI

@MainActor struct PodiumRing: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let medal: CompetitionMedal
  let size: CGFloat

  private var color: Color {
    switch medal {
    case .gold: Color(red: 1, green: 0.76, blue: 0.12)
    case .silver: Color(red: 0.59, green: 0.63, blue: 0.68)
    case .bronze: Color(red: 0.62, green: 0.37, blue: 0.20)
    }
  }

  var body: some View {
    Group {
      if medal == .gold, !reduceMotion {
        TimelineView(.animation(minimumInterval: 1.0 / 24)) { context in
          let phase =
            context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 4) / 4
          ZStack {
            ring
            Circle().stroke(
              AngularGradient(
                colors: [color, color, Color(red: 1, green: 0.94, blue: 0.62), color, color],
                center: .center), lineWidth: 2.5
            )
            .rotationEffect(.degrees(phase * 360))
            .padding(-4)
            ForEach(0..<3) { index in
              let pulse = pow(max(0, sin((phase + Double(index) / 3) * .pi * 2)), 3)
              Image(systemName: "sparkle")
                .font(.system(size: index == 0 ? 8 : 5, weight: .semibold))
                .foregroundStyle(Color(red: 1, green: 0.85, blue: 0.35))
                .opacity(pulse)
                .scaleEffect(0.65 + pulse * 0.35)
                .offset(
                  x: [-0.55, -0.15, 0.54][index] * size,
                  y: [-0.30, -0.60, -0.15][index] * size - pulse * 3)
            }
          }
        }
      } else {
        ring
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private var ring: some View {
    Circle().stroke(color, lineWidth: medal == .gold ? 2.5 : 1.5)
      .padding(-4)
      .shadow(color: medal == .gold ? color.opacity(0.25) : .clear, radius: 3)
  }
}
