import SwiftUI

struct LeaderboardPodiumPlaceholder: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shimmering = false

  var body: some View {
    shapes
      .foregroundStyle(.quaternary)
      .overlay {
        if !reduceMotion {
          GeometryReader { geometry in
            LinearGradient(
              colors: [.clear, .primary.opacity(0.12), .clear],
              startPoint: .leading, endPoint: .trailing
            )
            .frame(width: geometry.size.width / 2)
            .offset(x: shimmering ? geometry.size.width : -geometry.size.width / 2)
          }
          .mask { shapes }
        }
      }
      .animation(
        reduceMotion ? nil : .linear(duration: 1.4).repeatForever(autoreverses: false),
        value: shimmering
      )
      .onAppear { shimmering = true }
      .accessibilityHidden(true)
  }

  private var shapes: some View {
    HStack(alignment: .bottom, spacing: 16) {
      ForEach([2, 1, 3], id: \.self) { rank in
        VStack(spacing: 8) {
          Circle().frame(width: rank == 1 ? 64 : 48, height: rank == 1 ? 64 : 48)
          Capsule().frame(width: 60, height: 12)
        }
        .frame(maxWidth: .infinity)
      }
    }
  }
}
