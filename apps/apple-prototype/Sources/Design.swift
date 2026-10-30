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
// Broad, quiet folds share a single canvas so the glass samples one coherent backdrop.
struct Wallpaper: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                LinearGradient(colors: [Color(hex: "#216f68"), Color(hex: "#07514e"), Color(hex: "#26796e")], startPoint: .topLeading, endPoint: .bottomTrailing)
                Canvas { context, canvas in
                    func point(_ x: Double, _ y: Double) -> CGPoint {
                        CGPoint(x: canvas.width * x, y: canvas.height * y)
                    }
                    // Six oversized fan blades, rather than a field of repeating stripes.
                    let hub = point(0.16, 0.26)
                    let radius = canvas.height * 0.77
                    for index in 0..<6 {
                        let angle = Double(index) * .pi / 3 - 0.4
                        func polar(_ a: Double, _ r: Double) -> CGPoint {
                            CGPoint(x: hub.x + cos(a) * r, y: hub.y + sin(a) * r)
                        }
                        var blade = Path()
                        blade.move(to: hub)
                        blade.addCurve(to: polar(angle, radius),
                                       control1: polar(angle - 0.8, radius * 0.48),
                                       control2: polar(angle - 0.45, radius * 0.92))
                        blade.addQuadCurve(to: polar(angle + 0.65, radius * 0.87), control: polar(angle + 0.28, radius * 1.06))
                        blade.addCurve(to: hub, control1: polar(angle + 0.22, radius * 0.65), control2: polar(angle + 0.55, radius * 0.2))
                        context.fill(blade, with: .linearGradient(
                            Gradient(colors: [Color(hex: "#75b3a3").opacity(0.27), Color(hex: "#003f40").opacity(0.26)]),
                            startPoint: polar(angle, radius), endPoint: hub))
                    }
                    var fold = Path()
                    fold.move(to: point(0.34, 1.12))
                    fold.addCurve(to: point(0.71, -0.16), control1: point(0.33, 0.54), control2: point(0.82, 0.4))
                    fold.addCurve(to: point(0.91, 0.04), control1: point(0.87, -0.08), control2: point(0.94, -0.03))
                    fold.addCurve(to: point(0.57, 1.1), control1: point(0.91, 0.55), control2: point(0.51, 0.55))
                    fold.closeSubpath()
                    context.fill(fold, with: .linearGradient(Gradient(colors: [Color(hex: "#66aa9b").opacity(0.25), Color(hex: "#003e40").opacity(0.35)]), startPoint: point(0.52, 0.3), endPoint: point(0.78, 0.7)))
                    let circle = CGRect(x: canvas.width * 0.64, y: canvas.height * 0.53, width: canvas.height * 0.88, height: canvas.height * 0.88)
                    context.fill(Path(ellipseIn: circle), with: .linearGradient(Gradient(colors: [Color(hex: "#80b9a9").opacity(0.17), .clear]), startPoint: point(0.7, 0.55), endPoint: point(1, 1)))
                    var arc = Path()
                    arc.addArc(center: point(0.82, 1.08), radius: canvas.height * 0.69, startAngle: .degrees(190), endAngle: .degrees(305), clockwise: false)
                    context.stroke(arc, with: .color(Color(hex: "#0a4645").opacity(0.22)), style: StrokeStyle(lineWidth: canvas.height * 0.11))
                }.blur(radius: 3)
                RadialGradient(colors: [Color(hex: "#91bbad").opacity(0.08), .clear], center: .topLeading, startRadius: 0, endRadius: size.width * 0.7)
            }
        }.ignoresSafeArea()
    }
}
struct LampsBackdrop: View {
    var body: some View {
        ZStack {
            Color.black
            RadialGradient(colors: [.orange.opacity(0.28), .orange.opacity(0.08), .clear], center: UnitPoint(x: 0.3, y: 0.55), startRadius: 60, endRadius: 1000)
        }.ignoresSafeArea()
    }
}
struct GlassSurface: View {
    var on = false
    var radius: CGFloat = 38
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(on ? Color.white.opacity(0.58) : Color.white.opacity(0.035))
            .glassEffect(.regular.tint(on ? .white.opacity(0.5) : .clear).interactive(), in: .rect(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(.white.opacity(on ? 0.4 : 0.16), lineWidth: 0.8))
    }
}
struct CircleButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 56
    var clearGlass = false
    let action: () -> Void
    var body: some View {
        if clearGlass {
            button.buttonStyle(.plain).faceGlass(radius: size / 2)
        } else {
            button.buttonStyle(.glass).buttonBorderShape(.circle)
        }
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

// Native glass supplies edge lighting and refraction; no painted specular overlay.
extension View {
    func homeGlass(on: Bool = false, radius: CGFloat = 38) -> some View {
        self.glassEffect(.regular.tint(on ? .orange.opacity(0.2) : .clear).interactive(), in: .rect(cornerRadius: radius))
    }
    func faceGlass(on: Bool = false, radius: CGFloat = 56) -> some View {
        self.glassEffect(.clear.tint(on ? .orange.opacity(0.12) : .clear).interactive(), in: .rect(cornerRadius: radius))
    }
}
