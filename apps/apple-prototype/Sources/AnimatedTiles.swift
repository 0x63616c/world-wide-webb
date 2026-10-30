import SwiftUI

extension EnvironmentValues {
    /// nil for live animation; explicit seconds for deterministic stills.
    @Entry var motionPhase: Double? = nil
    @Entry var desktopLayout = false
}

struct LampGlow: View {
    let on: Bool
    let brightness: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    private var intensity: Double { on ? Double(brightness) / 100 : 0 }
    var body: some View {
        if reduceMotion || phase != nil || !on {
            glow.opacity(intensity * 0.30)
        } else {
            glow.phaseAnimator([0.25, 0.37]) { content, value in
                content.opacity(intensity * value)
            } animation: { _ in .easeInOut(duration: 3) }
        }
    }
    private var glow: some View {
        RadialGradient(colors: [.orange, .yellow.opacity(0.25), .clear], center: .center, startRadius: 0, endRadius: 120)
    }
}

struct ChargingPulse: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    struct Values { var opacity = 0.65 }
    var body: some View {
        if active && !reduceMotion && phase == nil {
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        Image(systemName: "fan.fill")
            .symbolEffect(.rotate, options: .speed(0.25), isActive: on && !reduceMotion && phase == nil)
    }
}

struct WeatherSky: View {
    let condition: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var fixedPhase
    private var raining: Bool { condition.localizedCaseInsensitiveContains("rain") }
    private var cloudy: Bool { condition.localizedCaseInsensitiveContains("cloud") || raining }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion || fixedPhase != nil)) { timeline in
            let t = fixedPhase ?? (reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate)
            GeometryReader { proxy in
                ZStack {
                    MeshGradient(width: 3, height: 3, points: [
                        [0,0], [0.5,0], [1,0], [0,0.5], [Float(0.5 + sin(t / 12) * 0.035),0.5], [1,0.5], [0,1], [0.5,1], [1,1]
                    ], colors: raining
                        ? [.gray, .gray, .blue.mix(with: .black, by: 0.6), .gray, .blue.mix(with: .gray, by: 0.6), .gray, .blue.mix(with: .black, by: 0.5), .gray, .gray]
                        : [.blue.mix(with: .black, by: 0.45), .blue, .cyan, .blue, .blue.mix(with: .cyan, by: 0.3), .cyan, .blue.mix(with: .black, by: 0.25), .blue, .cyan.mix(with: .white, by: 0.2)])
                    if !raining {
                        Circle().fill(.yellow.opacity(0.9)).frame(width: proxy.size.width * 0.22)
                            .blur(radius: 2).position(x: proxy.size.width * 0.75, y: proxy.size.height * 0.25)
                            .shadow(color: .yellow.opacity(0.45), radius: 35)
                    }
                    Canvas { context, size in
                        if cloudy {
                            for i in 0..<4 {
                                let offset = sin(t / 18 + Double(i)) * size.width * 0.06
                                let rect = CGRect(x: size.width * (0.15 + Double(i) * 0.19) + offset, y: size.height * (0.20 + Double(i % 2) * 0.12), width: size.width * 0.5, height: size.height * 0.14)
                                context.addFilter(.blur(radius: 20))
                                context.fill(Path(ellipseIn: rect), with: .color(.white.opacity(0.22)))
                            }
                        }
                        if raining {
                            for i in 0..<32 {
                                let x = Double((i * 43) % 100) / 100 * size.width
                                let y = (Double(i) / 32 + t * 0.18).truncatingRemainder(dividingBy: 1) * size.height
                                var path = Path(); path.move(to: CGPoint(x: x, y: y)); path.addLine(to: CGPoint(x: x - 5, y: y + 18))
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
                    Text("\(weather.temperature)°").font(.system(size: proxy.size.height * 0.27, weight: .light)).monospacedDigit()
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20, paused: !playing || reduceMotion || phase != nil)) { context in
            let t = phase ?? (reduceMotion || !playing ? 0 : context.date.timeIntervalSinceReferenceDate)
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
            .background(Color(hex: room.artworkTint).opacity(0.55), in: .rect(cornerRadius: 56))
    }
}
