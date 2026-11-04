import AirMilesCore
import SwiftUI

/// Slots keep native tab/navigation layouts while a single live globe moves between them.
struct GlobePlacement: Equatable {
    var id: String
    var rect: CGRect
    var flights: [Flight]
    var emphasized: Flight?
    var clipRect: CGRect?
    var visibleRect: CGRect {
        let visible = rect.intersection(clipRect ?? rect)
        guard !visible.isNull else { return .zero }
        return visible.offsetBy(dx: -rect.minX, dy: -rect.minY)
    }
}

private struct GlobeClipKey: EnvironmentKey { static let defaultValue: CGRect? = nil }
extension EnvironmentValues {
    var globeClipRect: CGRect? {
        get { self[GlobeClipKey.self] }
        set { self[GlobeClipKey.self] = newValue }
    }
}

/// Clip and hit-test the shared renderer to its actual scroll viewport, below navigation chrome.
struct GlobeClipRegion: ViewModifier {
    @State private var bounds: CGRect?
    func body(content: Content) -> some View {
        content.environment(\.globeClipRect, bounds)
            .onGeometryChange(for: CGRect.self) { proxy in
                let frame = proxy.frame(in: .named("globeRoot"))
                // Navigation can already offset the viewport by its safe area.
                // Adding the inset again cuts the globe in compact detail views.
                let top = max(frame.minY, proxy.safeAreaInsets.top)
                return CGRect(x: frame.minX, y: top, width: frame.width,
                              height: max(0, frame.maxY - top))
            } action: { bounds = $0 }
    }
}

struct GlobeClipShape: Shape {
    var rect: CGRect
    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>> {
        get { AnimatablePair(AnimatablePair(rect.minX, rect.minY), AnimatablePair(rect.width, rect.height)) }
        set { rect = CGRect(x: newValue.first.first, y: newValue.first.second,
                           width: newValue.second.first, height: newValue.second.second) }
    }
    func path(in bounds: CGRect) -> Path { Path(rect) }
}

struct GlobePlacementKey: PreferenceKey {
    static let defaultValue: [String: GlobePlacement] = [:]
    static func reduce(value: inout [String: GlobePlacement], nextValue: () -> [String: GlobePlacement]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct GlobeSlot: View {
    var id: String
    var flights: [Flight]
    var emphasized: Flight?
    var height: CGFloat = 280
    @Environment(GlobeInteraction.self) private var interaction
    @Environment(\.globeClipRect) private var clipRect
    var body: some View {
        Color.clear.background {
            GeometryReader { proxy in
                Color.clear.preference(key: GlobePlacementKey.self, value: [id: GlobePlacement(
                    id: id, rect: proxy.frame(in: .named("globeRoot")), flights: flights, emphasized: emphasized, clipRect: clipRect)])
            }
        }.modifier(GlobeFrame(baseHeight: height, interaction: interaction))
            .accessibilityHidden(true)
    }
}

/// Grow the viewport itself when zooming so neither pole is cut by a fixed panel.
struct GlobeFrame: ViewModifier {
    var baseHeight: CGFloat
    var interaction: GlobeInteraction
    @State private var width: CGFloat = 0
    func body(content: Content) -> some View {
        content.frame(height: min(baseHeight * interaction.zoom, max(baseHeight, width)))
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

struct GlobeControls: View {
    @Bindable var interaction: GlobeInteraction
    var allowsRotation = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        HStack(spacing: 8) {
            if interaction.changedByUser {
                Button { interaction.resetToken += 1 } label: {
                    Image(systemName: "arrow.counterclockwise").frame(width: 44, height: 44)
                }.accessibilityLabel("Reset globe")
            }
            if !reduceMotion && allowsRotation {
                Button { interaction.spinning.toggle() } label: {
                    Image(systemName: interaction.spinning ? "pause" : "play").frame(width: 44, height: 44)
                }.accessibilityLabel(interaction.spinning ? "Pause globe" : "Rotate globe")
                    .accessibilityIdentifier("globeMotion")
            }
        }.font(.system(size: 12, weight: .medium)).buttonStyle(GlobeControlStyle())
    }
}

private struct GlobeControlStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(.thinMaterial, in: Circle()).opacity(configuration.isPressed ? 0.6 : 1)
    }
}
