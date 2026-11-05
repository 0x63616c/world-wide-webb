import SwiftUI

/// Shared filled bar for Music and Lights. Preview locally during a drag and
/// commit once on release, with the same range and stepping for VoiceOver.
struct FilledLevelControl: View {
    let value: Int
    let label: String
    var symbol: String
    var range: ClosedRange<Int> = 0...100
    var step = 1
    var unit = "percent"
    var track: Gradient? = nil
    var fill: (Int) -> Color = { _ in .primary.opacity(0.22) }
    var preview: (Int?) -> Void = { _ in }
    let commit: (Int) -> Void
    @Environment(\.isEnabled) private var enabled
    @State private var dragging: Int?
    private var displayed: Int { min(range.upperBound, max(range.lowerBound, dragging ?? value)) }
    private func stepped(_ value: Double) -> Int {
        let step = max(1, step)
        let rounded = range.lowerBound + Int(((value - Double(range.lowerBound)) / Double(step)).rounded()) * step
        return min(range.upperBound, max(range.lowerBound, rounded))
    }
    var body: some View {
        GeometryReader { proxy in
            let span = Double(max(1, range.upperBound - range.lowerBound))
            let fraction = Double(displayed - range.lowerBound) / span
            ZStack(alignment: .leading) {
                Color.clear
                if let track { LinearGradient(gradient: track, startPoint: .leading, endPoint: .trailing).opacity(0.35) }
                Rectangle().fill(fill(displayed)).frame(width: proxy.size.width * fraction)
                Image(systemName: symbol).font(.system(size: 22))
                    .foregroundStyle(.primary).padding(.leading, 24)
                Capsule().fill(.primary.opacity(0.9)).frame(width: 4, height: 22)
                    .offset(x: max(12, min(proxy.size.width - 16, proxy.size.width * fraction - 10)))
            }.clipShape(.rect(cornerRadius: 24))
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        guard enabled, proxy.size.width > 0 else { return }
                        let fraction = max(0, min(1, drag.location.x / proxy.size.width))
                        dragging = stepped(Double(range.lowerBound) + fraction * span)
                        preview(dragging)
                    }
                    .onEnded { _ in
                        if enabled, let dragging { commit(dragging) }
                        dragging = nil
                        preview(nil)
                    })
        }.opacity(enabled ? 1 : 0.4)
            .accessibilityElement(children: .ignore).accessibilityLabel(label)
            .accessibilityValue("\(displayed) \(unit)")
            .accessibilityAdjustableAction { direction in
                guard enabled else { return }
                let increment = max(step, range.upperBound - range.lowerBound > 100 ? step : 5)
                switch direction {
                case .increment: commit(stepped(Double(value + increment)))
                case .decrement: commit(stepped(Double(value - increment)))
                @unknown default: break
                }
            }
            .onChange(of: enabled) { _, enabled in if !enabled { dragging = nil; preview(nil) } }
            .onDisappear { preview(nil) }
    }
}
