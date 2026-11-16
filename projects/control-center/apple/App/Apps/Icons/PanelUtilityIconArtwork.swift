import SwiftUI

// Artwork stays inside an optically balanced 62–66% live area. Layers use the
// same two depths as Weather, Lights, Music and Photos; all measurements scale.
struct CalendarIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            // Each line is placed by its baseline so the two sit on fixed optical lines.
            Color.clear
                .overlay(alignment: .top) {
                    Text(context.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(.system(size: side * 0.165, weight: .heavy))
                        .tracking(side * 0.011)
                        .foregroundStyle(Color(hex: "#D2402E"))
                        .modifier(IconBaseline(y: side * 0.347))
                        .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
                }
                .overlay(alignment: .top) {
                    Text(context.date.formatted(.dateTime.day()))
                        .font(.system(size: side * 0.475, weight: .bold))
                        .tracking(-side * 0.009)
                        .foregroundStyle(Color(hex: "#18181B"))
                        .modifier(IconBaseline(y: side * 0.764))
                        .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
                }
        }.frame(width: side, height: side)
    }
}

/// Puts a text line's first baseline `y` points below the top of the view it overlays.
/// An overlay never changes its host's size, so tall glyphs cannot shift the artwork.
private struct IconBaseline: ViewModifier {
    let y: CGFloat
    func body(content: Content) -> some View {
        content.lineLimit(1).fixedSize()
            .alignmentGuide(.top) { $0[.firstTextBaseline] - y }
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
    private let ink = Color(hex: "#18181B")
    var body: some View {
        let stroke = StrokeStyle(lineWidth: side * 0.067, lineCap: .round)
        ZStack {
            IconSignalArc(radius: 0.360).stroke(ink, style: stroke)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                IconSignalArc(radius: 0.242).stroke(ink, style: stroke)
                IconSignalArc(radius: 0.124).stroke(ink, style: stroke)
                Circle().fill(ink)
                    .frame(width: side * 0.107, height: side * 0.107)
                    .position(x: side * 0.50, y: side * IconSignalArc.centerY)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

private struct IconSignalArc: Shape {
    static let centerY: CGFloat = 0.681
    let radius: CGFloat
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.addArc(
                center: CGPoint(x: rect.midX, y: rect.minY + rect.height * Self.centerY),
                radius: rect.width * radius,
                startAngle: .degrees(224), endAngle: .degrees(316), clockwise: false)
        }
    }
}

struct SettingsIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            // Off: a muted track with a white knob.
            ZStack {
                Capsule().fill(Color(hex: "#AEB5C0"))
                    .frame(width: side * 0.534, height: side * 0.215)
                    .position(x: side * 0.50, y: side * 0.626)
                Circle().fill(.white)
                    .frame(width: side * 0.157, height: side * 0.157)
                    .shadow(color: .black.opacity(0.2), radius: side * 0.007, y: side * 0.008)
                    .position(x: side * 0.340, y: side * 0.626)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            // On: a white track with a knob in the tile colour.
            ZStack {
                Capsule()
                    .fill(LinearGradient(colors: [.white, Color(hex: "#E6E9EE")], startPoint: .top, endPoint: .bottom))
                    .frame(width: side * 0.534, height: side * 0.215)
                    .shadow(color: .black.opacity(0.2), radius: side * 0.007, y: side * 0.008)
                    .position(x: side * 0.50, y: side * 0.374)
                Circle().fill(Color(hex: "#5E6572"))
                    .frame(width: side * 0.157, height: side * 0.157)
                    .position(x: side * 0.660, y: side * 0.374)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}
