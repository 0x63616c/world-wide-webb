import SwiftUI

/// Colour maths for the lamp pickers. Lamps take hue and saturation; brightness is its own control.
enum LampColor {
    /// Below this the spectrum is indistinguishable from white, which the White look already covers.
    static let saturationFloor = 0.15

    static func hex(hue: Double, saturation: Double) -> String {
        let sector = (hue - hue.rounded(.down)) * 6
        let saturation = min(1, max(0, saturation))
        let ramp = 1 - abs(sector.truncatingRemainder(dividingBy: 2) - 1)
        let (red, green, blue): (Double, Double, Double) =
            switch Int(sector) {
            case 0: (1, ramp, 0)
            case 1: (ramp, 1, 0)
            case 2: (0, 1, ramp)
            case 3: (0, ramp, 1)
            case 4: (ramp, 0, 1)
            default: (1, 0, ramp)
            }
        let channel = { (value: Double) in Int(((1 - saturation + saturation * value) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channel(red), channel(green), channel(blue))
    }

    static func hueSaturation(hex: String) -> (hue: Double, saturation: Double) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        let red = Double((value >> 16) & 255) / 255
        let green = Double((value >> 8) & 255) / 255
        let blue = Double(value & 255) / 255
        let high = max(red, green, blue)
        let delta = high - min(red, green, blue)
        guard high > 0, delta > 0 else { return (0, 0) }
        let sector =
            if high == red {
                ((green - blue) / delta).truncatingRemainder(dividingBy: 6)
            } else if high == green {
                (blue - red) / delta + 2
            } else {
                (red - green) / delta + 4
            }
        return ((sector < 0 ? sector + 6 : sector) / 6, delta / high)
    }

    static func name(hex: String) -> String {
        let (hue, saturation) = hueSaturation(hex: hex)
        if saturation < saturationFloor { return "White" }
        switch hue * 360 {
        case ..<15: return "Red"
        case ..<45: return "Orange"
        case ..<70: return "Yellow"
        case ..<165: return "Green"
        case ..<200: return "Teal"
        case ..<255: return "Blue"
        case ..<290: return "Purple"
        case ..<335: return "Pink"
        default: return "Red"
        }
    }

    static func temperatureName(_ kelvin: Int) -> String {
        switch kelvin {
        case ..<2400: "Candlelight"
        case ..<3300: "Warm white"
        case ..<4600: "Neutral white"
        case ..<5600: "Cool white"
        default: "Daylight"
        }
    }
}

/// Keeps a released drag value on screen until the store reports it, or gives up after five
/// seconds so a failed or rejected command never leaves a control stuck.
private struct ReleasedValueHold<Value: Equatable & Sendable>: ViewModifier {
    let value: Value
    @Binding var released: Value?
    func body(content: Content) -> some View {
        content
            .onChange(of: value) { _, value in
                if value == released { released = nil }
            }
            .task(id: released) {
                guard released != nil else { return }
                if value == released {
                    released = nil
                    return
                }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                released = nil
            }
    }
}

/// The loupe shared by the colour and temperature fields.
private struct PickerThumb: View {
    let color: Color
    let active: Bool
    var body: some View {
        Circle().fill(color)
            .overlay(Circle().strokeBorder(.white, lineWidth: 4))
            .frame(width: 44, height: 44)
            .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
            .scaleEffect(active ? 1.35 : 1)
            .animation(.snappy(duration: 0.18), value: active)
            .allowsHitTesting(false)
    }
}

private let pickerInset: CGFloat = 30

/// Home-style vertical dimmer. Previews locally during a drag and commits on release.
struct LampDimmer: View {
    let value: Int
    let on: Bool
    let colors: [Color]
    var preview: (Int?) -> Void = { _ in }
    let commit: (Int) -> Void
    let turnOn: () -> Void
    @GestureState private var dragging: Int?
    @State private var released: Int?
    private var shown: Int { on ? min(100, max(0, dragging ?? released ?? value)) : 0 }
    var body: some View {
        GeometryReader { proxy in
            let radius = min(56, proxy.size.width * 0.38)
            let level: (CGFloat) -> Int = { y in
                Int((100 * (1 - min(1, max(0, y / max(1, proxy.size.height))))).rounded())
            }
            ZStack(alignment: .bottom) {
                Color.white.opacity(0.06)
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: colors.count > 1 ? colors : [colors.first ?? .white, colors.first ?? .white],
                            startPoint: .top, endPoint: .bottom)
                    )
                    .frame(height: proxy.size.height * Double(shown) / 100)
                Image(systemName: on ? "sun.max.fill" : "power")
                    .font(.system(size: min(36, proxy.size.width * 0.3), weight: .medium))
                    .foregroundStyle(shown > 12 ? Color.black.opacity(0.7) : .white)
                    .padding(.bottom, 28)
            }
            .clipShape(.rect(cornerRadius: radius))
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: radius))
            .contentShape(.rect(cornerRadius: radius))
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($dragging) { drag, state, _ in
                        if on { state = level(drag.location.y) }
                    }
                    .onEnded { drag in
                        guard on else { return turnOn() }
                        let target = level(drag.location.y)
                        released = target
                        commit(target)
                    })
        }
        .animation(.smooth(duration: 0.25), value: on)
        .onChange(of: dragging) { _, value in preview(value) }
        .onChange(of: on) { _, _ in released = nil }
        .onDisappear { preview(nil) }
        .modifier(ReleasedValueHold(value: value, released: $released))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lamp brightness")
        .accessibilityValue(on ? "\(shown) percent" : "Off")
        .accessibilityHint(on ? "Adjusts every lamp" : "Turns the lamps on")
        .accessibilityAdjustableAction { direction in
            guard on else { return }
            switch direction {
            case .increment: commit(min(100, shown + 5))
            case .decrement: commit(max(0, shown - 5))
            @unknown default: break
            }
        }
    }
}

/// Warm-to-daylight strip with a draggable loupe.
struct TemperatureField: View {
    let kelvin: Int
    var preview: (Int?) -> Void = { _ in }
    let commit: (Int) -> Void
    @Environment(\.isEnabled) private var enabled
    @GestureState private var dragging: Int?
    @State private var released: Int?
    private var shown: Int { min(6500, max(2000, (enabled ? dragging : nil) ?? released ?? kelvin)) }
    var body: some View {
        GeometryReader { proxy in
            let span = max(1, proxy.size.width - pickerInset * 2)
            let value: (CGFloat) -> Int = { x in
                2000 + Int((min(1, max(0, (x - pickerInset) / span)) * 45).rounded()) * 100
            }
            let thumbX = pickerInset + span * CGFloat(shown - 2000) / 4500
            LinearGradient(gradient: WhiteTemperaturePreview.gradient, startPoint: .leading, endPoint: .trailing)
                .clipShape(.rect(cornerRadius: 28))
                .overlay {
                    PickerThumb(color: WhiteTemperaturePreview.color(shown), active: dragging != nil)
                        .position(x: thumbX, y: proxy.size.height / 2)
                }
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .updating($dragging) { drag, state, _ in
                            if enabled { state = value(drag.location.x) }
                        }
                        .onEnded { drag in
                            guard enabled else { return }
                            let target = value(drag.location.x)
                            released = target
                            commit(target)
                        })
        }
        .onChange(of: dragging) { _, value in preview(value) }
        .onChange(of: enabled) { _, _ in released = nil }
        .onDisappear { preview(nil) }
        .modifier(ReleasedValueHold(value: kelvin, released: $released))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("White temperature")
        .accessibilityValue("\(shown) kelvin")
        .accessibilityAdjustableAction { direction in
            guard enabled else { return }
            switch direction {
            case .increment: commit(min(6500, shown + 100))
            case .decrement: commit(max(2000, shown - 100))
            @unknown default: break
            }
        }
    }
}

/// Hue across, saturation down. Drag the loupe; the colour is committed on release.
struct ColorSpectrumField: View {
    let hex: String
    var preview: (String?) -> Void = { _ in }
    let commit: (String) -> Void
    @GestureState private var dragging: String?
    @State private var released: String?
    private var shown: String { dragging ?? released ?? hex }
    private static let hues = Gradient(
        colors: stride(from: 0.0, through: 1.0, by: 1.0 / 12).map { Color(hue: $0, saturation: 1, brightness: 1) })
    var body: some View {
        GeometryReader { proxy in
            let width = max(1, proxy.size.width - pickerInset * 2)
            let height = max(1, proxy.size.height - pickerInset * 2)
            let range = 1 - LampColor.saturationFloor
            let color: (CGPoint) -> String = { point in
                // Stopping just short of a full turn keeps the right edge from wrapping back to the left.
                let hue = min(0.985, max(0, Double((point.x - pickerInset) / width)))
                let depth = min(1, max(0, Double((point.y - pickerInset) / height)))
                return LampColor.hex(hue: hue, saturation: 1 - depth * range)
            }
            let position = LampColor.hueSaturation(hex: shown)
            let thumbX = pickerInset + width * CGFloat(position.hue)
            let thumbY = pickerInset + height * CGFloat(min(1, max(0, (1 - position.saturation) / range)))
            ZStack {
                LinearGradient(gradient: Self.hues, startPoint: .leading, endPoint: .trailing)
                    .padding(.horizontal, pickerInset)
                    .background(Color(hue: 0, saturation: 1, brightness: 1))
                LinearGradient(
                    colors: [.white.opacity(0), .white.opacity(range)], startPoint: .top, endPoint: .bottom
                )
                .padding(.vertical, pickerInset)
                .background(alignment: .bottom) { Color.white.opacity(range).frame(height: pickerInset) }
            }
            .clipShape(.rect(cornerRadius: 28))
            .overlay {
                PickerThumb(color: Color(hex: shown), active: dragging != nil)
                    .position(x: thumbX, y: thumbY)
            }
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($dragging) { drag, state, _ in state = color(drag.location) }
                    .onEnded { drag in
                        let target = color(drag.location)
                        released = target
                        commit(target)
                    })
        }
        .onChange(of: dragging) { _, value in preview(value) }
        .onDisappear { preview(nil) }
        .modifier(ReleasedValueHold(value: hex, released: $released))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lamp colour")
        .accessibilityValue(LampColor.name(hex: shown))
        .accessibilityAdjustableAction { direction in
            let (hue, saturation) = LampColor.hueSaturation(hex: shown)
            let step = direction == .increment ? 1.0 / 24 : -1.0 / 24
            commit(LampColor.hex(hue: hue + step + 1, saturation: max(LampColor.saturationFloor, saturation)))
        }
    }
}
