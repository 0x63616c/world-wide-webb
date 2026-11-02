import SwiftUI

/// Atmospheric artwork follows the provider's current conditions and day/night symbol.
struct WeatherAtmosphere: View {
    let weather: WeatherState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var fixedPhase
    private var description: String { (weather.condition + " " + weather.symbol).lowercased() }
    private var night: Bool { description.contains("moon") || description.contains("night") }
    private var rain: Bool { ["rain", "drizzle", "storm"].contains { description.contains($0) } }
    private var snow: Bool { ["snow", "sleet", "blizzard"].contains { description.contains($0) } }
    private var fog: Bool { ["fog", "mist", "haze"].contains { description.contains($0) } }
    private var clouds: Bool { description.contains("cloud") || description.contains("overcast") || rain || snow || fog }
    private var overcast: Bool { description.contains("overcast") || weather.symbol == "cloud.fill" }
    private var colors: [Color] {
        if night { return [Color(hex: "#08152d"), Color(hex: "#243958"), Color(hex: "#0b1b35")] }
        if rain || snow { return [Color(hex: "#354a62"), Color(hex: "#758b9c"), Color(hex: "#344c66")] }
        if overcast { return [Color(hex: "#4d667d"), Color(hex: "#8198a8"), Color(hex: "#3b5872")] }
        if fog { return [Color(hex: "#617888"), Color(hex: "#9aabb5"), Color(hex: "#526c82")] }
        return [Color(hex: "#1268af"), Color(hex: "#459bce"), Color(hex: "#246c9e")]
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion || scenePhase != .active || fixedPhase != nil)) { tick in
            let time = fixedPhase ?? (reduceMotion ? 0 : tick.date.timeIntervalSinceReferenceDate)
            GeometryReader { geometry in
                let size = geometry.size
                ZStack {
                    LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
                    if !rain && !snow && !fog && !overcast {
                        RadialGradient(colors: [.white.opacity(night ? 0.12 : 0.6), .white.opacity(0.08), .clear], center: UnitPoint(x: 0.82 + sin(time / 30) * 0.025, y: 0.14), startRadius: 8, endRadius: size.width * 0.42)
                        Circle().fill(night ? Color.white.opacity(0.85) : Color(hex: "#fff4cf"))
                            .frame(width: night ? 42 : 68, height: night ? 42 : 68)
                            .position(x: size.width * 0.82, y: size.height * 0.14)
                    }
                    Canvas { context, canvas in
                        if night && !clouds {
                            for index in 0..<60 {
                                let x = Double((index * 73 + 19) % 997) / 997 * canvas.width
                                let y = Double((index * 137 + 41) % 991) / 991 * canvas.height * 0.65
                                let alpha = 0.3 + (sin(time / 3 + Double(index)) + 1) * 0.2
                                context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 2, height: 2)), with: .color(.white.opacity(alpha)))
                            }
                        }
                        if clouds {
                            context.drawLayer { layer in
                                layer.addFilter(.blur(radius: fog ? 65 : 34))
                                for index in 0..<8 {
                                    let drift = sin(time / 35 + Double(index)) * canvas.width * 0.07
                                    let x = Double(index % 4) * canvas.width / 3 - canvas.width * 0.22 + drift
                                    let y = canvas.height * (0.1 + Double(index / 4) * 0.19)
                                    let rect = CGRect(x: x, y: y, width: canvas.width * 0.52, height: canvas.height * 0.16)
                                    layer.fill(Path(ellipseIn: rect), with: .color(.white.opacity(night ? 0.08 : 0.19)))
                                }
                            }
                        }
                        if rain || snow {
                            for index in 0..<90 {
                                let x = Double((index * 79) % 997) / 997 * canvas.width
                                let y = (Double(index) / 90 + time * (snow ? 0.035 : 0.3)).truncatingRemainder(dividingBy: 1) * canvas.height
                                if snow {
                                    context.fill(Path(ellipseIn: CGRect(x: x + sin(time + Double(index)) * 12, y: y, width: 4, height: 4)), with: .color(.white.opacity(0.65)))
                                } else {
                                    var streak = Path(); streak.move(to: CGPoint(x: x, y: y)); streak.addLine(to: CGPoint(x: x - 7, y: y + 22))
                                    context.stroke(streak, with: .color(.white.opacity(0.25)), lineWidth: 1)
                                }
                            }
                        }
                    }
                    LinearGradient(colors: [.clear, .black.opacity(0.12), .black.opacity(0.4)], startPoint: .top, endPoint: .bottom)
                }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
