import SwiftUI

enum Palette {
    static let teal = Color(hex: "#075955")
    static let ink = Color(hex: "#123e3c")
    static let amber = Color(hex: "#bb721c")
    static let cool = Color(hex: "#087bb4")
    static let heat = Color(hex: "#c76524")
    static let range = Color(hex: "#7557aa")
    static let graphite = Color(hex: "#38434a")
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
struct Wallpaper: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                LinearGradient(colors: [Color(hex: "#176d68"), Color(hex: "#064440"), Color(hex: "#328f84")], startPoint: .topLeading, endPoint: .bottomTrailing)
                ForEach(0..<7) { i in
                    RoundedRectangle(cornerRadius: 70, style: .continuous)
                        .fill(LinearGradient(colors: [Color(hex: "#8ad1bc").opacity(0.38), Color(hex: "#023d3d").opacity(0.6)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: size.width * 0.75, height: size.height * 0.18)
                        .rotationEffect(.degrees(-48))
                        .position(x: size.width * (0.08 + Double(i) * 0.19), y: size.height * (i.isMultiple(of: 2) ? 0.2 : 0.72))
                }
                Ellipse().fill(Color(hex: "#8acbbb").opacity(0.28))
                    .frame(width: size.width * 0.75, height: size.height * 0.65)
                    .rotationEffect(.degrees(-40)).offset(x: -size.width * 0.3, y: size.height * 0.36)
            }
            .blur(radius: 14).drawingGroup()
            .overlay(Color.black.opacity(0.08))
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
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size * 0.38, weight: .medium)).frame(width: size, height: size)
        }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityLabel(label)
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
        .background { GlassSurface(on: selected, radius: 24) }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
struct SectionLabel: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 19, weight: .semibold)).foregroundStyle(.white.opacity(0.7)) }
}
struct AnalogClock: View {
    let date: Date
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
                ForEach(0..<60) { tick in
                    Capsule().fill(.white.opacity(tick.isMultiple(of: 5) ? 0.95 : 0.28))
                        .frame(width: tick.isMultiple(of: 5) ? 4 : 1.5, height: tick.isMultiple(of: 5) ? side * 0.065 : side * 0.025)
                        .offset(y: -side * 0.44).rotationEffect(.degrees(Double(tick) * 6))
                }
                hand(length: side * 0.26, width: 7, angle: hour * 30)
                hand(length: side * 0.37, width: 5, angle: minute * 6)
                hand(length: side * 0.39, width: 1.4, angle: seconds * 6).opacity(0.65)
                Circle().fill(.white).frame(width: 10, height: 10)
                Circle().trim(from: 0, to: seconds / 60).stroke(.white.opacity(0.22), lineWidth: 1)
                    .rotationEffect(.degrees(-90)).padding(2)
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
