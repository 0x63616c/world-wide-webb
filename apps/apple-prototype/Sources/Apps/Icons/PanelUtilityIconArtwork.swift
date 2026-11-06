import SwiftUI

// Artwork stays inside an optically balanced 62–66% live area. Layers use the
// same two depths as Weather, Lights, Music and Photos; all measurements scale.
struct CalendarIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: side * 0.055)
                .fill(Color(hex: "#FFC5CC"))
                .frame(width: side * 0.57, height: side * 0.60)
                .rotationEffect(.degrees(-7))
                .position(x: side * 0.46, y: side * 0.47)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            TimelineView(.periodic(from: .now, by: 60)) { context in
                VStack(spacing: side * 0.008) {
                    Text(context.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(.system(size: side * 0.105, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#EC3854"))
                    Text(context.date.formatted(.dateTime.day()))
                        .font(.system(size: side * 0.35, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(hex: "#273044"))
                        .monospacedDigit()
                }
                .frame(width: side * 0.58, height: side * 0.61)
                .background(.white, in: .rect(cornerRadius: side * 0.055))
            }
            .position(x: side * 0.53, y: side * 0.53)
            .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

struct ClimateIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: side * 0.072) {
                ForEach(0..<4) { index in
                    Capsule().fill(Color(hex: "#A9EEFF"))
                        .frame(width: side * (index.isMultiple(of: 2) ? 0.13 : 0.085), height: side * 0.036)
                }
            }
            .position(x: side * 0.69, y: side * 0.43)
            .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                Capsule().fill(.white)
                    .frame(width: side * 0.20, height: side * 0.48)
                    .position(x: side * 0.425, y: side * 0.42)
                Circle().fill(.white)
                    .frame(width: side * 0.33, height: side * 0.33)
                    .position(x: side * 0.425, y: side * 0.665)
                Capsule().fill(Color(hex: "#1CA6E7"))
                    .frame(width: side * 0.069, height: side * 0.29)
                    .position(x: side * 0.425, y: side * 0.51)
                Circle().fill(Color(hex: "#1CA6E7"))
                    .frame(width: side * 0.20, height: side * 0.20)
                    .position(x: side * 0.425, y: side * 0.665)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

struct WifiIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            IconSignalArc(radius: 0.425)
                .stroke(.white, style: StrokeStyle(lineWidth: side * 0.063, lineCap: .round))
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                IconSignalArc(radius: 0.28)
                    .stroke(.white, style: StrokeStyle(lineWidth: side * 0.063, lineCap: .round))
                IconSignalArc(radius: 0.135)
                    .stroke(.white, style: StrokeStyle(lineWidth: side * 0.063, lineCap: .round))
                Circle().fill(.white)
                    .frame(width: side * 0.083, height: side * 0.083)
                    .position(x: side * 0.50, y: side * 0.71)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

private struct IconSignalArc: Shape {
    let radius: CGFloat
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.addArc(center: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.71),
                        radius: rect.width * radius,
                        startAngle: .degrees(225), endAngle: .degrees(315), clockwise: false)
        }
    }
}

struct SettingsIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: "#C7D9F0"))
                .frame(width: side * 0.35, height: side * 0.35)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            IconGearShape().fill(.white, style: FillStyle(eoFill: true))
                .frame(width: side * 0.65, height: side * 0.65)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
            Circle().fill(Color(hex: "#6E86A7"))
                .frame(width: side * 0.19, height: side * 0.19)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
        }.frame(width: side, height: side)
    }
}

private struct IconGearShape: Shape {
    func path(in rect: CGRect) -> Path {
        let radius = min(rect.width, rect.height) / 2
        func point(_ degrees: Double, _ scale: CGFloat) -> CGPoint {
            let radians = degrees * .pi / 180
            return CGPoint(x: rect.midX + cos(radians) * radius * scale,
                           y: rect.midY + sin(radians) * radius * scale)
        }
        var path = Path()
        for tooth in 0..<8 {
            let angle = Double(tooth) * 45
            let points = [point(angle - 22.5, 0.79), point(angle - 13, 0.79),
                          point(angle - 10, 0.97), point(angle - 6, 1),
                          point(angle + 6, 1), point(angle + 10, 0.97),
                          point(angle + 13, 0.79), point(angle + 22.5, 0.79)]
            for (index, point) in points.enumerated() {
                if tooth == 0 && index == 0 { path.move(to: point) }
                else { path.addLine(to: point) }
            }
        }
        path.closeSubpath()
        path.addEllipse(in: rect.insetBy(dx: rect.width * 0.30, dy: rect.height * 0.30))
        return path
    }
}
