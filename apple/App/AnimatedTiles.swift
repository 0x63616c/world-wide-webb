import SwiftUI

extension EnvironmentValues {
    /// nil for live animation; explicit seconds for deterministic stills.
    @Entry var motionPhase: Double? = nil
}

struct LampGlow: View {
    let on: Bool
    let brightness: Int
    @Environment(\.motionPhase) private var phase
    private var intensity: Double { on ? Double(brightness) / 100 : 0 }
    var body: some View {
        if phase != nil || !on {
            glow.opacity(intensity * 0.30)
        } else {
            glow.phaseAnimator([0.25, 0.37]) { content, value in
                content.opacity(intensity * value)
            } animation: { _ in
                .easeInOut(duration: 3)
            }
        }
    }
    private var glow: some View {
        GeometryReader { proxy in
            RadialGradient(
                colors: [.orange, .yellow.opacity(0.25), .clear], center: .center,
                startRadius: 0, endRadius: min(proxy.size.width, proxy.size.height) / 2)
        }
    }
}

struct ChargingPulse: View {
    let active: Bool
    @Environment(\.motionPhase) private var phase
    struct Values { var opacity = 0.65 }
    var body: some View {
        if active && phase == nil {
            KeyframeAnimator(initialValue: Values(), repeating: true) { values in
                Image(systemName: "bolt.fill").foregroundStyle(.green).opacity(values.opacity)
            } keyframes: { _ in
                KeyframeTrack(\.opacity) {
                    CubicKeyframe(1, duration: 1.4)
                    CubicKeyframe(0.65, duration: 1.4)
                }
            }
        } else {
            Image(systemName: active ? "bolt.fill" : "battery.75percent").foregroundStyle(active ? .green : .secondary)
        }
    }
}

struct FanSymbol: View {
    let on: Bool
    @Environment(\.motionPhase) private var phase
    var body: some View {
        Image(systemName: "fan.fill")
            .symbolEffect(.rotate, options: .speed(0.25), isActive: on && phase == nil)
    }
}

struct WeatherSky: View {
    let condition: String
    @Environment(\.motionPhase) private var fixedPhase
    private var raining: Bool { condition.localizedCaseInsensitiveContains("rain") }
    private var cloudy: Bool { condition.localizedCaseInsensitiveContains("cloud") || raining }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: fixedPhase != nil)) { timeline in
            let t = fixedPhase ?? timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { proxy in
                ZStack {
                    MeshGradient(
                        width: 3, height: 3,
                        points: [
                            [0, 0], [0.5, 0], [1, 0], [0, 0.5], [Float(0.5 + sin(t / 12) * 0.035), 0.5], [1, 0.5],
                            [0, 1], [0.5, 1], [1, 1],
                        ],
                        colors: raining
                            ? [
                                .gray, .gray, .blue.mix(with: .black, by: 0.6), .gray, .blue.mix(with: .gray, by: 0.6),
                                .gray, .blue.mix(with: .black, by: 0.5), .gray, .gray,
                            ]
                            : [
                                .blue.mix(with: .black, by: 0.45), .blue, .cyan, .blue, .blue.mix(with: .cyan, by: 0.3),
                                .cyan, .blue.mix(with: .black, by: 0.25), .blue, .cyan.mix(with: .white, by: 0.2),
                            ])
                    if cloudy {
                        Image("CloudPhoto").resizable().scaledToFill()
                            .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                            .scaleEffect(1.08).offset(x: sin(t / 24) * 10)
                            .saturation(raining ? 0.15 : 0.80)
                            .overlay(.black.opacity(raining ? 0.50 : 0.18))
                    } else {
                        Circle().fill(.white.opacity(0.9)).frame(width: proxy.size.width * 0.06)
                            .blur(radius: 1).position(x: proxy.size.width * 0.78, y: proxy.size.height * 0.23)
                    }
                    if raining {
                        Canvas { context, size in
                            for i in 0..<32 {
                                let x = Double((i * 43) % 100) / 100 * size.width
                                let y = (Double(i) / 32 + t * 0.18).truncatingRemainder(dividingBy: 1) * size.height
                                var path = Path()
                                path.move(to: CGPoint(x: x, y: y))
                                path.addLine(to: CGPoint(x: x - 5, y: y + 18))
                                context.stroke(path, with: .color(.white.opacity(0.35)), lineWidth: 1.2)
                            }
                        }
                    }
                    LinearGradient(colors: [.clear, .black.opacity(0.35)], startPoint: .top, endPoint: .bottom)
                }
            }
        }.accessibilityHidden(true)
    }
}

struct WeatherTile: View {
    let weather: WeatherState
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                WeatherSky(condition: weather.condition)
                VStack(alignment: .leading, spacing: 4) {
                    Text(weather.city).font(.system(size: 32, weight: .medium))
                    Text("\(weather.temperature)°").font(.system(size: proxy.size.height * 0.27, weight: .light))
                        .monospacedDigit()
                    Spacer()
                    Image(systemName: "cloud.sun.fill").symbolRenderingMode(.multicolor).font(.system(size: 44))
                    Text(weather.condition).font(.system(size: 28, weight: .medium))
                    Text("H:\(weather.high)°  L:\(weather.low)°").font(.system(size: 24)).foregroundStyle(.secondary)
                }.padding(36)
            }.clipShape(.rect(cornerRadius: 56))
        }
    }
}

struct PlayingEqualizer: View {
    let playing: Bool
    @Environment(\.motionPhase) private var phase
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20, paused: !playing || phase != nil)) { context in
            let t = phase ?? (!playing ? 0 : context.date.timeIntervalSinceReferenceDate)
            HStack(alignment: .center, spacing: 4) {
                ForEach(0..<5) { i in
                    Capsule().frame(width: 4, height: playing ? 8 + 16 * (sin(t * 3 + Double(i) * 1.6) + 1) / 2 : 4)
                }
            }.frame(width: 36, height: 28)
        }.accessibilityLabel(playing ? "Playing" : "Paused")
    }
}

struct SonosTile: View {
    let room: SoundRoom
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                FixtureArtwork(tint: room.artworkTint).frame(width: 100, height: 100).clipShape(.rect(cornerRadius: 16))
                Spacer()
                PlayingEqualizer(playing: room.playing).foregroundStyle(.primary)
            }
            Text(room.trackTitle ?? "Nothing playing").font(.system(size: 28, weight: .semibold)).lineLimit(2)
            Text(room.name).font(.system(size: 22)).foregroundStyle(.secondary)
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

    }
}

/// Five live, condition-aware treatments at the exact Home tile size.
struct WeatherDesignCard: View {
    let weather: WeatherState
    let style: Int
    static let names = ["Atmosphere", "Glass forecast", "Horizon", "Typography", "Orbital"]
    var body: some View {
        ZStack {
            WeatherDesignSky(condition: weather.condition, symbol: weather.symbol, style: style)
            layout.padding(28)
        }.foregroundStyle(.white).clipShape(.rect(cornerRadius: 40))
    }
    private var temperature: some View {
        Text("\(weather.temperature)°").font(.system(size: style == 3 ? 132 : 88, weight: .light, design: .rounded))
            .monospacedDigit()
    }
    private var range: some View {
        Text("H:\(weather.high)°  L:\(weather.low)°").font(.system(size: 17, weight: .medium)).opacity(0.8)
    }
    private var symbol: some View {
        Image(systemName: weather.symbol).symbolRenderingMode(.multicolor).font(.system(size: 32))
    }
    private var forecast: some View {
        HStack(spacing: 0) {
            ForEach(weather.hours.prefix(4)) { hour in
                VStack(spacing: 9) {
                    Text(hour.time).font(.system(size: 13, weight: .medium)).opacity(0.8)
                    Image(systemName: hour.symbol).symbolRenderingMode(.multicolor).font(.system(size: 18)).frame(
                        height: 22)
                    Text("\(hour.temperature)°").font(.system(size: 18, weight: .medium))
                }.frame(maxWidth: .infinity)
            }
        }
    }
    @ViewBuilder private var layout: some View {
        switch style {
        case 1:
            VStack(alignment: .leading, spacing: 0) {
                Text(weather.city).font(.system(size: 24, weight: .semibold))
                HStack {
                    temperature
                    Spacer()
                    symbol
                }
                Text(weather.condition).font(.system(size: 19, weight: .medium))
                range.padding(.top, 5)
                Spacer()
                forecast.padding(16).glassEffect(.regular, in: .rect(cornerRadius: 24))
            }
        case 2:
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(weather.city).font(.system(size: 22, weight: .semibold))
                    Spacer()
                    symbol
                }
                temperature
                Spacer()
                Text(weather.condition).font(.system(size: 22, weight: .semibold))
                range.padding(.top, 5)
                Divider().overlay(.white.opacity(0.2)).padding(.vertical, 18)
                forecast
            }
        case 3:
            VStack(alignment: .leading, spacing: 0) {
                Text(weather.city.uppercased()).font(.system(size: 15, weight: .bold)).tracking(2)
                Spacer()
                temperature
                HStack {
                    Text(weather.condition).font(.system(size: 20, weight: .medium))
                    Spacer()
                    symbol
                }
                range.padding(.top, 10)
                Spacer()
                Text("Feels like \(weather.feels)° · \(weather.wind) mph wind").font(.system(size: 15)).opacity(0.75)
            }
        case 4:
            VStack(spacing: 0) {
                Text(weather.city).font(.system(size: 22, weight: .semibold))
                Spacer()
                ZStack {
                    Circle().stroke(.white.opacity(0.18), lineWidth: 1).frame(width: 228, height: 228)
                    VStack(spacing: 0) {
                        symbol
                        temperature
                        range
                    }
                }
                Spacer()
                Text(weather.condition).font(.system(size: 22, weight: .medium))
            }.frame(maxWidth: .infinity)
        default:
            VStack(alignment: .leading, spacing: 0) {
                Text(weather.city).font(.system(size: 24, weight: .semibold))
                temperature
                Spacer()
                Text(weather.condition).font(.system(size: 23, weight: .semibold))
                range.padding(.top, 6)
                forecast.padding(.top, 26)
            }
        }
    }
}

private struct WeatherDesignSky: View {
    let condition: String
    let symbol: String
    let style: Int
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var fixedPhase
    private var wet: Bool { condition.localizedCaseInsensitiveContains("rain") }
    private var cloudy: Bool { condition.localizedCaseInsensitiveContains("cloud") || wet }
    private var night: Bool { symbol.contains("moon") || symbol.contains("night") }
    private var palette: [Color] {
        if wet { return [Color(hex: "#172b41"), Color(hex: "#465c76"), Color(hex: "#121d30")] }
        if night { return [Color(hex: "#090e2c"), Color(hex: "#28335d"), Color(hex: "#0b132d")] }
        switch style {
        case 1: return [Color(hex: "#163858"), Color(hex: "#4d93ac"), Color(hex: "#162e49")]
        case 2: return [Color(hex: "#20528d"), Color(hex: "#79a6c3"), Color(hex: "#263955")]
        case 3: return [Color(hex: "#101b2c"), Color(hex: "#23476b"), Color(hex: "#09101a")]
        case 4: return [Color(hex: "#152b38"), Color(hex: "#386b78"), Color(hex: "#142333")]
        default: return [Color(hex: "#12529c"), Color(hex: "#61aaca"), Color(hex: "#174c7a")]
        }
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20, paused: scenePhase != .active || fixedPhase != nil)) {
            timeline in
            let t = fixedPhase ?? timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { proxy in
                let s = proxy.size
                ZStack {
                    MeshGradient(
                        width: 3, height: 3,
                        points: [
                            [0, 0], [0.5, 0], [1, 0], [0, 0.5],
                            [Float(0.5 + sin(t / 9) * 0.15), Float(0.5 + cos(t / 12) * 0.12)], [1, 0.5], [0, 1],
                            [0.5, 1], [1, 1],
                        ],
                        colors: [
                            palette[0], palette[0], palette[1], palette[0], palette[1], palette[1], palette[2],
                            palette[2], palette[2],
                        ])
                    if !cloudy {
                        Circle().fill(
                            RadialGradient(
                                colors: [.white.opacity(0.5), .yellow.opacity(0.12), .clear], center: .center,
                                startRadius: 0, endRadius: 145)
                        )
                        .frame(width: 290, height: 290)
                        .position(x: s.width * (style == 4 ? 0.5 : 0.82) + sin(t / 14) * 12, y: s.height * 0.25)
                        if style == 0 {
                            Circle().fill(night ? .white.opacity(0.85) : Color(hex: "#fff0b8"))
                                .frame(width: night ? 29 : 45, height: night ? 29 : 45)
                                .position(x: s.width * 0.82 + sin(t / 14) * 12, y: s.height * 0.25)
                        }
                    }
                    if cloudy || style == 2 {
                        Canvas { context, size in
                            for i in 0..<3 {
                                let shift = sin(t / 18 + Double(i)) * 18
                                let y = size.height * (0.42 + Double(i) * 0.1)
                                var path = Path()
                                path.move(to: CGPoint(x: -40, y: y))
                                path.addCurve(
                                    to: CGPoint(x: size.width + 40, y: y + 40),
                                    control1: CGPoint(x: size.width * 0.3 + shift, y: y - 60),
                                    control2: CGPoint(x: size.width * 0.7 + shift, y: y + 70))
                                path.addLine(to: CGPoint(x: size.width + 40, y: size.height))
                                path.addLine(to: CGPoint(x: -40, y: size.height))
                                path.closeSubpath()
                                context.fill(path, with: .color(.white.opacity(cloudy ? 0.1 : 0.045)))
                            }
                        }
                    }
                    if wet {
                        Canvas { context, size in
                            for i in 0..<28 {
                                let x = Double((i * 47) % 100) / 100 * size.width
                                let y = (Double(i) / 28 + t * 0.16).truncatingRemainder(dividingBy: 1) * size.height
                                var p = Path()
                                p.move(to: CGPoint(x: x, y: y))
                                p.addLine(to: CGPoint(x: x - 4, y: y + 16))
                                context.stroke(p, with: .color(.white.opacity(0.3)), lineWidth: 1)
                            }
                        }
                    }
                    LinearGradient(
                        colors: [.clear, .black.opacity(style == 3 ? 0.35 : 0.18)], startPoint: .top, endPoint: .bottom)
                }
            }
        }.accessibilityHidden(true)
    }
}
