import SwiftUI

enum ArtStyle: String, CaseIterable, Identifiable {
    case aurora, ribbons, ocean, stars, contours, eclipse, dunes, prism, embers, paper
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var palette: [Color] {
        switch self {
        case .aurora: [.black, Color(hex: "#07544d"), .mint, .indigo]
        case .ribbons: [Color(hex: "#100e20"), .indigo, .pink, .orange]
        case .ocean: [Color(hex: "#031b30"), .blue, .cyan, .teal]
        case .stars: [Color(hex: "#050817"), .indigo, .white, .cyan]
        case .contours: [Color(hex: "#111c1b"), .teal, .mint, .green]
        case .eclipse: [.black, Color(hex: "#4b2818"), .orange, .yellow]
        case .dunes: [Color(hex: "#251612"), Color(hex: "#704539"), Color(hex: "#b77b51"), Color(hex: "#e2af75")]
        case .prism: [Color(hex: "#0b1022"), .blue, .purple, .pink]
        case .embers: [Color(hex: "#120907"), .red, .orange, .yellow]
        case .paper: [Color(hex: "#152024"), Color(hex: "#35565b"), Color(hex: "#708e89"), Color(hex: "#c3c7b5")]
        }
    }
}

/// Procedural SwiftUI art, no downloaded images or per-frame random allocation.
struct ArtWallpaper: View {
    let style: ArtStyle
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var fixedPhase
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: scenePhase != .active || fixedPhase != nil)) {
            tick in
            let time = fixedPhase ?? tick.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                let palette = style.palette
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(palette[0]))
                switch style {
                case .aurora, .ribbons:
                    context.addFilter(.blur(radius: style == .aurora ? 36 : 5))
                    for index in 0..<6 {
                        let i = Double(index)
                        let y = size.height * (0.12 + i * 0.13)
                        var ribbon = Path()
                        ribbon.move(to: CGPoint(x: -100, y: y))
                        ribbon.addCurve(
                            to: CGPoint(x: size.width + 100, y: y + sin(time / 20 + i) * 150),
                            control1: CGPoint(x: size.width * 0.32, y: y - size.height * 0.5 + sin(time / 18 + i) * 90),
                            control2: CGPoint(x: size.width * 0.65, y: y + size.height * 0.5))
                        context.stroke(
                            ribbon,
                            with: .linearGradient(
                                Gradient(colors: [palette[1], palette[2], palette[3]]), startPoint: .zero,
                                endPoint: CGPoint(x: size.width, y: size.height)),
                            lineWidth: style == .aurora ? 100 : 32)
                    }
                case .ocean, .dunes, .paper:
                    for index in 0..<9 {
                        let i = Double(index)
                        let y = size.height * (0.12 + i * 0.11)
                        let drift = sin(time / (style == .ocean ? 9 : 30) + i * 0.7) * size.height * 0.05
                        var wave = Path()
                        wave.move(to: CGPoint(x: -10, y: y))
                        wave.addCurve(
                            to: CGPoint(x: size.width + 10, y: y + drift),
                            control1: CGPoint(x: size.width * 0.3, y: y - size.height * 0.26 + drift),
                            control2: CGPoint(x: size.width * 0.7, y: y + size.height * 0.22))
                        wave.addLine(to: CGPoint(x: size.width + 10, y: size.height + 10))
                        wave.addLine(to: CGPoint(x: -10, y: size.height + 10))
                        wave.closeSubpath()
                        context.fill(wave, with: .color(palette[1 + index % 3].opacity(0.75)))
                        if style == .ocean { context.stroke(wave, with: .color(.white.opacity(0.1)), lineWidth: 2) }
                    }
                case .contours:
                    for index in 0..<30 {
                        let inset = Double(index) * 30
                        var line = Path()
                        for step in 0...120 {
                            let angle = Double(step) / 120 * .pi * 2
                            let radius = inset + 100 + sin(angle * 3 + time / 20) * 28
                            let point = CGPoint(
                                x: size.width * 0.54 + cos(angle) * radius * 1.5,
                                y: size.height * 0.52 + sin(angle) * radius)
                            if step == 0 { line.move(to: point) } else { line.addLine(to: point) }
                        }
                        context.stroke(line, with: .color(palette[2].opacity(0.3)), lineWidth: 1.5)
                    }
                case .stars, .embers:
                    for index in 0..<140 {
                        let i = Double(index)
                        let x = Double((index * 137 + 23) % 997) / 997 * size.width
                        let position = Double((index * 71 + 31) % 991) / 991
                        let y = (position + time * (style == .stars ? 0.001 : -0.012)).truncatingRemainder(
                            dividingBy: 1)
                        let normalized = y < 0 ? y + 1 : y
                        let diameter = style == .stars ? 1.5 + Double(index % 3) : 2 + Double(index % 5)
                        let glow = 0.25 + (sin(time / 4 + i) + 1) * 0.25
                        context.fill(
                            Path(
                                ellipseIn: CGRect(
                                    x: x + sin(time / 10 + i) * 9, y: normalized * size.height, width: diameter,
                                    height: diameter)), with: .color(palette[2].opacity(glow)))
                    }
                case .eclipse:
                    let diameter = min(size.width, size.height) * 0.62
                    let centre = CGPoint(x: size.width * 0.6, y: size.height * 0.45)
                    let rect = CGRect(
                        x: centre.x - diameter / 2, y: centre.y - diameter / 2, width: diameter, height: diameter)
                    context.drawLayer { glow in
                        glow.addFilter(.blur(radius: 35 + sin(time / 15) * 8))
                        glow.stroke(Path(ellipseIn: rect), with: .color(palette[2]), lineWidth: 22)
                    }
                    context.fill(Path(ellipseIn: rect), with: .color(.black))
                    context.stroke(Path(ellipseIn: rect), with: .color(palette[3].opacity(0.7)), lineWidth: 2)
                case .prism:
                    for index in 0..<7 {
                        let i = Double(index)
                        let x = size.width * (0.1 + i * 0.14) + sin(time / 24 + i) * 20
                        var facet = Path()
                        facet.move(to: CGPoint(x: x, y: -100))
                        facet.addLine(to: CGPoint(x: x + size.width * 0.35, y: size.height * 0.45))
                        facet.addLine(to: CGPoint(x: x - size.width * 0.2, y: size.height + 100))
                        facet.closeSubpath()
                        context.fill(
                            facet,
                            with: .linearGradient(
                                Gradient(colors: [palette[1 + index % 3].opacity(0.55), .clear]),
                                startPoint: CGPoint(x: x, y: 0), endPoint: CGPoint(x: x, y: size.height)))
                    }
                }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
