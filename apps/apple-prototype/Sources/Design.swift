import SwiftUI

enum Palette {
    static let teal = Color.teal.mix(with: .black, by: 0.65)
    static let ink = Color.black
    static let amber = Color.orange.mix(with: .black, by: 0.65)
    static let cool = Color.blue.mix(with: .black, by: 0.5)
    static let heat = Color.orange.mix(with: .black, by: 0.4)
    static let range = Color.purple.mix(with: .black, by: 0.4)
    static let graphite = Color.gray.mix(with: .black, by: 0.7)
    // Original clock artwork, calum_6: same hue/saturation, 7% lower brightness.
    static let clock = Color(red: 67.0 / 255 * 0.93, green: 166.0 / 255 * 0.93, blue: 106.0 / 255 * 0.93)
}
extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
extension ClimateMode {
    var color: Color {
        switch self { case .cool: Palette.cool; case .heat: Palette.heat; case .heatCool: Palette.range; case .off: Palette.graphite }
    }
}
// Luca Bravo / Unsplash. Full attribution and licence in docs/v2/sources.md.
struct Wallpaper: View {
    var body: some View {
        GeometryReader { proxy in
            Image("LakeWallpaper").resizable().scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                .overlay(.black.opacity(0.25))
        }.ignoresSafeArea()
    }
}
struct LampsBackdrop: View {
    var body: some View {
        Color(white: 0.055).ignoresSafeArea()
    }
}
struct CircleButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 64
    var clearGlass = false
    let action: () -> Void
    var body: some View {
        button.buttonStyle(.glass).buttonBorderShape(.circle)
    }
    private var button: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size * 0.38, weight: .medium)).frame(width: size, height: size)
        }.accessibilityLabel(label)
    }
}
struct Choice: View {
    let title: String
    var selected = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 18, weight: .semibold)).padding(.horizontal, 18).frame(minHeight: 48)
                .foregroundStyle(selected ? Palette.ink : .white)
        }
        .buttonStyle(.plain)
        .homeGlass(on: selected, radius: 24)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
struct SectionLabel: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 19, weight: .semibold)).foregroundStyle(.white.opacity(0.7)) }
}
struct AnalogClock: View {
    let date: Date
    var minimal = false
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            var calendar: Calendar {
                var value = Calendar(identifier: .gregorian)
                value.timeZone = TimeZone(identifier: "America/Los_Angeles")!
                return value
            }
            let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            let minute = Double(calendar.component(.minute, from: date)) + seconds / 60
            let hour = Double(calendar.component(.hour, from: date) % 12) + minute / 60
            ZStack {
                ForEach(Array(stride(from: 0, to: 60, by: minimal ? 5 : 1)), id: \.self) { tick in
                    Capsule().fill(.white.opacity(tick.isMultiple(of: 5) ? 0.95 : 0.28))
                        .frame(width: tick.isMultiple(of: 5) ? 4 : 1.5, height: tick.isMultiple(of: 5) ? side * 0.065 : side * 0.025)
                        .offset(y: -side * 0.44).rotationEffect(.degrees(Double(tick) * 6))
                }
                hand(length: side * 0.26, width: 7, angle: hour * 30)
                hand(length: side * 0.37, width: 5, angle: minute * 6)
                Capsule().fill(.orange).frame(width: 2, height: side * 0.39).offset(y: -side * 0.195 + 5).rotationEffect(.degrees(seconds * 6))
                Circle().fill(.white).frame(width: 10, height: 10)
                if !minimal {
                    Circle().trim(from: 0, to: seconds / 60).stroke(.white.opacity(0.22), lineWidth: 1)
                        .rotationEffect(.degrees(-90)).padding(2)
                }
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }.accessibilityLabel("Analog clock")
    }
    private func hand(length: CGFloat, width: CGFloat, angle: Double) -> some View {
        Capsule().fill(.white).frame(width: width, height: length).offset(y: -length / 2 + 5).rotationEffect(.degrees(angle))
    }
}
func fixtureTime(_ date: Date, format: String = "h:mm") -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = TimeZone(identifier: "America/Los_Angeles")
    formatter.dateFormat = format
    return formatter.string(from: date)
}

// One system material, applied after layout; no surface fills or painted rims.
extension View {
    func homeGlass(on: Bool = false, radius: CGFloat = 38) -> some View {
        self.glassEffect((on ? Glass.regular.tint(.orange.opacity(0.25)) : .regular).interactive(), in: .rect(cornerRadius: radius))
            .containerShape(.rect(cornerRadius: radius))
    }
    func faceGlass(on: Bool = false, radius: CGFloat = 56) -> some View {
        self.glassEffect((on ? Glass.regular.tint(.orange.opacity(0.18)) : .clear).interactive(), in: .rect(cornerRadius: radius))
            .containerShape(.rect(cornerRadius: radius))
    }
}

struct FaceMaterial: ViewModifier {
    let tile: HomeTile
    let on: Bool
    let radius: CGFloat
    func body(content: Content) -> some View {
        content.faceGlass(on: on, radius: radius)
    }
}
