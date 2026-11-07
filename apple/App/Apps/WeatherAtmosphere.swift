import SwiftUI

/// Atmospheric artwork follows the provider's current conditions and day/night symbol.
struct WeatherAtmosphere: View {
    let weather: WeatherState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var fixedPhase
    private var description: String { (weather.condition + " " + weather.symbol).lowercased() }
    private var night: Bool { description.contains("moon") || description.contains("night") }
    private var rain: Bool { ["rain", "drizzle", "storm", "thunder"].contains { description.contains($0) } }
    private var storm: Bool { ["storm", "thunder"].contains { description.contains($0) } }
    private var snow: Bool { ["snow", "sleet", "blizzard"].contains { description.contains($0) } }
    private var fog: Bool { ["fog", "mist", "haze"].contains { description.contains($0) } }
    private var clouds: Bool {
        description.contains("cloud") || description.contains("overcast") || rain || snow || fog
    }
    private var overcast: Bool { description.contains("overcast") || weather.symbol == "cloud.fill" }
    private var colors: [Color] {
        if night { return [Color(hex: "#08152d"), Color(hex: "#243958"), Color(hex: "#0b1b35")] }
        if rain || snow { return [Color(hex: "#354a62"), Color(hex: "#758b9c"), Color(hex: "#344c66")] }
        if fog { return [Color(hex: "#617888"), Color(hex: "#9aabb5"), Color(hex: "#526c82")] }
        if overcast { return [Color(hex: "#4d667d"), Color(hex: "#8198a8"), Color(hex: "#3b5872")] }
        return [Color(hex: "#1268af"), Color(hex: "#459bce"), Color(hex: "#246c9e")]
    }
    // Stable sampling avoids a visible grid while keeping animation continuous between frames.
    private func sample(_ index: Int, _ seed: Double) -> Double {
        let value = sin(Double(index) * 127.1 + seed * 311.7) * 43758.5453
        return value - floor(value)
    }
    /// Three crystalline silhouettes rotate independently among softer distant flakes.
    private func snowflake(at center: CGPoint, radius: CGFloat, angle: Double, style: Int) -> Path {
        var path = Path()
        let arms = 6
        for arm in 0..<arms {
            let direction = angle + Double(arm) * 2 * .pi / Double(arms)
            let dx = cos(direction)
            let dy = sin(direction)
            let length = style == 2 && arm % 2 == 1 ? radius * 0.65 : radius
            let tip = CGPoint(x: center.x + length * dx, y: center.y + length * dy)
            path.move(to: center)
            path.addLine(to: tip)
            if style == 1 {
                let joint = CGPoint(x: center.x + radius * 0.62 * dx, y: center.y + radius * 0.62 * dy)
                for side in [-1.0, 1.0] {
                    let branch = direction + .pi + side * .pi / 4
                    path.move(to: joint)
                    path.addLine(
                        to: CGPoint(x: joint.x + radius * 0.28 * cos(branch), y: joint.y + radius * 0.28 * sin(branch)))
                }
            }
        }
        return path
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: scenePhase != .active || fixedPhase != nil)) {
            tick in
            let time = fixedPhase ?? tick.date.timeIntervalSinceReferenceDate
            GeometryReader { geometry in
                let size = geometry.size
                ZStack {
                    LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
                    if !rain && !snow && !fog && !overcast {
                        RadialGradient(
                            colors: [
                                night ? .white.opacity(0.16) : Color(hex: "#fff3cd").opacity(0.65),
                                night ? .white.opacity(0.04) : Color(hex: "#ffdf9c").opacity(0.12), .clear,
                            ],
                            center: UnitPoint(x: 0.82 + sin(time / 30) * 0.025, y: 0.14),
                            startRadius: 8, endRadius: size.width * 0.48)
                        Circle().fill(night ? Color.white.opacity(0.85) : Color(hex: "#fff4cf"))
                            .frame(width: night ? 42 : 68, height: night ? 42 : 68)
                            .position(x: size.width * 0.82, y: size.height * 0.14)
                    }
                    Canvas { context, canvas in
                        if night && !overcast && !rain && !snow && !fog {
                            // A denser, uneven field: tiny distant stars and occasional brighter points.
                            for index in 0..<240 {
                                let x = sample(index, 1) * canvas.width
                                let y = sample(index, 2) * canvas.height * 0.84
                                let bright = sample(index, 3) > 0.89
                                let diameter = bright ? 1.7 + sample(index, 7) * 1.5 : 0.6 + sample(index, 7) * 1.1
                                let phase = sample(index, 4) * .pi * 2
                                let speed = 0.25 + sample(index, 5) * 0.7
                                let shimmer = (sin(time * speed + phase) + 1) / 2
                                let alpha = (bright ? 0.55 : 0.18 + sample(index, 6) * 0.28) * (0.55 + shimmer * 0.45)
                                let tint: Color = sample(index, 8) > 0.8 ? Color(hex: "#ffdfb5") : Color(hex: "#d7e8ff")
                                context.fill(
                                    Path(ellipseIn: CGRect(x: x, y: y, width: diameter, height: diameter)),
                                    with: .color(tint.opacity(alpha)))
                                if bright && index % 3 == 0 {
                                    var glint = Path()
                                    glint.move(to: CGPoint(x: x - diameter * 1.5, y: y + diameter / 2))
                                    glint.addLine(to: CGPoint(x: x + diameter * 2.5, y: y + diameter / 2))
                                    glint.move(to: CGPoint(x: x + diameter / 2, y: y - diameter * 1.5))
                                    glint.addLine(to: CGPoint(x: x + diameter / 2, y: y + diameter * 2.5))
                                    context.stroke(glint, with: .color(tint.opacity(alpha * 0.35)), lineWidth: 0.55)
                                }
                            }
                        }
                        if night && !clouds {
                            // One brief meteor at a different time and location each cycle.
                            let cycle = Int(floor(time / 32))
                            let elapsed = time - Double(cycle) * 32
                            let start = 6 + sample(cycle, 23) * 18
                            let progress = (elapsed - start) / 1.4
                            if progress >= 0 && progress <= 1 {
                                let origin = CGPoint(
                                    x: canvas.width * (0.12 + sample(cycle, 24) * 0.55),
                                    y: canvas.height * (0.05 + sample(cycle, 25) * 0.27))
                                let head = CGPoint(
                                    x: origin.x + canvas.width * 0.22 * progress,
                                    y: origin.y + canvas.height * 0.11 * progress)
                                let tail = CGPoint(
                                    x: head.x - canvas.width * 0.08,
                                    y: head.y - canvas.height * 0.04)
                                let opacity = sin(.pi * progress) * 0.8
                                var streak = Path()
                                streak.move(to: tail)
                                streak.addLine(to: head)
                                context.stroke(
                                    streak,
                                    with: .linearGradient(
                                        Gradient(colors: [.white.opacity(0), .white.opacity(opacity)]),
                                        startPoint: tail, endPoint: head),
                                    style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                context.fill(
                                    Path(ellipseIn: CGRect(x: head.x - 1.5, y: head.y - 1.5, width: 3, height: 3)),
                                    with: .color(.white.opacity(opacity)))
                            }
                        }
                        if clouds {
                            // Soft cloud banks overlap at varied sizes and drift at different speeds.
                            for layerIndex in 0..<2 {
                                context.drawLayer { layer in
                                    layer.addFilter(.blur(radius: fog ? 70 : (layerIndex == 0 ? 38 : 24)))
                                    for index in 0..<9 {
                                        let seed = index + layerIndex * 17
                                        let drift =
                                            sin(time / (28 + sample(seed, 31) * 35) + Double(index)) * canvas.width
                                            * 0.08
                                        let x = sample(seed, 32) * canvas.width * 1.5 - canvas.width * 0.4 + drift
                                        let y = canvas.height * (0.04 + sample(seed, 33) * (fog ? 0.7 : 0.42))
                                        let width = canvas.width * (0.25 + sample(seed, 34) * 0.4)
                                        let height = canvas.height * (0.07 + sample(seed, 35) * 0.11)
                                        let opacity = night ? 0.05 : (fog ? 0.12 : 0.13)
                                        layer.fill(
                                            Path(ellipseIn: CGRect(x: x, y: y, width: width, height: height)),
                                            with: .color(.white.opacity(opacity)))
                                    }
                                }
                            }
                        }
                        if storm {
                            // A distant, brief flash only for conditions reported as thunder or storm.
                            let pulse = (time + 7).truncatingRemainder(dividingBy: 23)
                            if pulse < 0.35 {
                                let intensity = sin(.pi * pulse / 0.35) * 0.11
                                context.fill(
                                    Path(CGRect(origin: .zero, size: canvas)), with: .color(.white.opacity(intensity)))
                            }
                        }
                        if (rain || snow) && canvas.width > 0 {
                            for index in 0..<120 {
                                let x = sample(index, 11) * canvas.width
                                let offset = sample(index, 12)
                                let speed = snow ? 0.025 + sample(index, 13) * 0.025 : 0.35 + sample(index, 13) * 0.35
                                let progress = (offset + time * speed).truncatingRemainder(dividingBy: 1)
                                let y = progress * (canvas.height + 40) - 20
                                if snow {
                                    let driftSpeed = 0.4 + sample(index, 16) * 0.5
                                    let snowX = x + sin(time * driftSpeed + offset * 10) * (8 + sample(index, 17) * 16)
                                    let brightness = 0.3 + sample(index, 15) * 0.35
                                    if index % 3 == 0 {
                                        let radius = 4 + sample(index, 14) * 4
                                        let angle =
                                            sample(index, 18) * .pi * 2 + time * (sample(index, 19) - 0.5) * 0.35
                                        let flake = snowflake(
                                            at: CGPoint(x: snowX, y: y), radius: radius, angle: angle,
                                            style: (index / 3) % 3)
                                        context.stroke(
                                            flake, with: .color(.white.opacity(brightness)),
                                            style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
                                    } else {
                                        let size = 2 + sample(index, 14) * 3
                                        context.fill(
                                            Path(ellipseIn: CGRect(x: snowX, y: y, width: size, height: size)),
                                            with: .color(.white.opacity(brightness)))
                                    }
                                } else {
                                    let length = 10 + sample(index, 14) * 23
                                    let alpha = 0.08 + sample(index, 15) * 0.19
                                    // Match the drop's path to the angle of its streak.
                                    let drift = (x - progress * (canvas.height + 40) * 0.22).truncatingRemainder(
                                        dividingBy: canvas.width)
                                    let rainX = drift < 0 ? drift + canvas.width : drift
                                    var streak = Path()
                                    streak.move(to: CGPoint(x: rainX, y: y))
                                    streak.addLine(to: CGPoint(x: rainX - length * 0.22, y: y + length))
                                    context.stroke(
                                        streak, with: .color(.white.opacity(alpha)),
                                        lineWidth: 0.6 + sample(index, 16) * 0.5)
                                }
                            }
                        }
                    }
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.12), .black.opacity(0.4)], startPoint: .top, endPoint: .bottom
                    )
                }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
