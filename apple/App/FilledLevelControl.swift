import SwiftUI

/// Shared filled bar for Sonos and Lights. Preview locally during a drag and
/// commit once on release, with the same range and stepping for VoiceOver.
struct FilledLevelControl: View {
    let value: Int
    let label: String
    var symbol: String
    var range: ClosedRange<Int> = 0...100
    var step = 1
    var unit = "percent"
    var showsPercentage = false
    var valueLabel: ((Int) -> String)? = nil
    var track: Gradient? = nil
    var fill: (Int) -> Color = { _ in .white.opacity(0.38) }
    var preview: (Int?) -> Void = { _ in }
    let commit: (Int) -> Void
    @Environment(\.isEnabled) private var enabled
    @GestureState private var dragging: Int?
    @State private var releasedValue: Int?
    @State private var valueWidth: CGFloat = 44
    private var showsValue: Bool { showsPercentage || valueLabel != nil }
    private var dragValue: Int? { enabled ? dragging : nil }
    private var displayed: Int { min(range.upperBound, max(range.lowerBound, dragValue ?? releasedValue ?? value)) }
    private func stepped(_ value: Double) -> Int {
        let step = max(1, step)
        let rounded = range.lowerBound + Int(((value - Double(range.lowerBound)) / Double(step)).rounded()) * step
        return min(range.upperBound, max(range.lowerBound, rounded))
    }
    var body: some View {
        GeometryReader { proxy in
            let span = Double(max(1, range.upperBound - range.lowerBound))
            let fraction = Double(displayed - range.lowerBound) / span
            let thumbX = max(12, min(proxy.size.width - 16, proxy.size.width * fraction - 10))
            let valueAt: (CGFloat) -> Int = { x in
                let fraction = max(0, min(1, x / proxy.size.width))
                return stepped(Double(range.lowerBound) + fraction * span)
            }
            ZStack(alignment: .leading) {
                Color.clear
                if let track {
                    LinearGradient(gradient: track, startPoint: .leading, endPoint: .trailing).opacity(0.35)
                }
                Rectangle().fill(fill(displayed)).frame(width: proxy.size.width * fraction)
                Image(systemName: symbol).font(.system(size: 22))
                    .foregroundStyle(.white).padding(.leading, 24)
                // The fill still reaches the end of the bar when the thumb enters the label area.
                if !showsValue || thumbX <= proxy.size.width - valueWidth - 36 {
                    Capsule().fill(.white.opacity(0.9)).frame(width: 4, height: 22)
                        .offset(x: thumbX)
                }
                if showsValue {
                    Text(valueLabel?(displayed) ?? "\(displayed)%")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .onGeometryChange(for: CGFloat.self) {
                            $0.size.width
                        } action: {
                            valueWidth = $0
                        }
                        .padding(.trailing, 24)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }.clipShape(.rect(cornerRadius: 24))
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .updating($dragging) { drag, value, _ in
                            guard enabled, proxy.size.width > 0 else { return }
                            value = valueAt(drag.location.x)
                        }
                        .onEnded { drag in
                            guard enabled, proxy.size.width > 0 else { return }
                            let target = valueAt(drag.location.x)
                            releasedValue = target
                            commit(target)
                        })
        }.opacity(enabled ? 1 : 0.4)
            .accessibilityElement(children: .ignore).accessibilityLabel(label)
            .accessibilityValue("\(displayed) \(unit)")
            .accessibilityAdjustableAction { direction in
                guard enabled else { return }
                let increment = max(step, range.upperBound - range.lowerBound > 100 ? step : 5)
                switch direction {
                case .increment: commit(stepped(Double(displayed + increment)))
                case .decrement: commit(stepped(Double(displayed - increment)))
                @unknown default: break
                }
            }
            .onChange(of: dragValue) { _, value in preview(value) }
            .onChange(of: value) { _, value in
                if value == releasedValue { releasedValue = nil }
            }
            .onChange(of: enabled) { _, _ in releasedValue = nil }
            .task(id: releasedValue) {
                guard let releasedValue else { return }
                if value == releasedValue {
                    self.releasedValue = nil
                    return
                }
                // A failed or rejected command must never leave a local value stuck.
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                self.releasedValue = nil
            }
            .onDisappear { preview(nil) }
    }
}
