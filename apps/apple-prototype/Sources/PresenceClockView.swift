import CoreText
import SwiftUI
import PanelKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum PanelClockFace: String, CaseIterable {
    case green, midnight, paper, ember, glass
}

/// The clock face, after Apple HomeView's green numeral clock (Apple Newsroom,
/// 13 Oct 2026): a full-bleed green field, four huge black cardinal numerals
/// pushed to the screen edges, white hands and a small date. No complications.
struct PresenceClockFace: View {
    let store: any HomeDataSource
    var face: PanelClockFace = .green
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        TimelineView(.animation(minimumInterval: reduceMotion || face == .glass ? 1 : 1.0 / 30, paused: phase != nil)) { _ in
            let now = store.now
            let hour = Calendar.current.component(.hour, from: now)
            let night = previewNight || (SolarClock.isNight(at: now, sunrise: store.weather.sunrise,
                sunset: store.weather.sunset, nextSunrise: store.weather.nextSunrise)
                ?? (store.status(for: .weather) != .live || store.weather.symbol.contains("moon") || hour < 7 || hour >= 18))
            ZStack {
                switch face {
                case .green:
                    night ? Color.black : GreenClockDial.green
                    GreenClockDial(date: now, night: night)
                case .midnight:
                    Color(red: 0.04, green: 0.07, blue: 0.16)
                    PanelDuoDial(date: now)
                case .paper:
                    PanelSolarDial(date: now, night: night)
                case .ember:
                    Color(red: 0.15, green: 0.05, blue: 0.035)
                    PanelRingDial(date: now)
                case .glass:
                    PanelGlassClockFace(date: now)
                }
            }.accessibilityIdentifier("clock-face")
        }.ignoresSafeArea()
    }
    private var previewNight: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-previewNightClock")
        #else
        false
        #endif
    }

}

/// Lays the face out in whatever rectangle it is given: landscape fills the
/// whole screen, portrait uses a near-square band so the numerals stay huge.
struct GreenClockDial: View {
    /// Sampled from the HomeView reference (Apple Newsroom faces image).
    static let green = Color(red: 63.0 / 255, green: 148.0 / 255, blue: 93.0 / 255)
    let date: Date
    var numeralsOnly = false
    var night = false
    private var ink: Color { night ? Color(red: 0.94, green: 0.21, blue: 0.23) : .black }
    private var handColor: Color { night ? Color(white: 0.9) : .white }

    /// Geometry shared with tests so they can check the reference proportions.
    struct Layout {
        let face: CGRect
        let digitHeight: CGFloat
        let fontSize: CGFloat
        let inset: CGFloat
        init(size: CGSize) {
            let height = size.width >= size.height ? size.height : min(size.height, size.width * 1.1)
            face = CGRect(x: 0, y: (size.height - height) / 2, width: size.width, height: height)
            digitHeight = min(face.height * 0.37, face.width * 0.32)
            fontSize = digitHeight / GreenClockDial.capHeightRatio
            inset = max(16, face.width * 0.045)
        }
        var center: CGPoint { CGPoint(x: face.midX, y: face.minY + face.height * 0.495) }
        var minuteLength: CGFloat { face.height * 0.43 }
        var hourLength: CGFloat { face.height * 0.26 }
        var handWidth: CGFloat { max(6, face.height * 0.022) }
    }
    static let weight: Font.Weight = .medium
    static let capHeightRatio: CGFloat = {
        let font = Self.roundedFont(size: 100)
        return CTFontGetCapHeight(font) / 100
    }()
    private static func roundedFont(size: CGFloat) -> CTFont {
        #if os(macOS)
        let base = NSFont.systemFont(ofSize: size, weight: .medium)
        let rounded = base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) }
        #else
        let base = UIFont.systemFont(ofSize: size, weight: .medium)
        let rounded = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) }
        #endif
        return CTFontCreateWithName((rounded ?? base).fontName as CFString, size, nil)
    }
    private static func verticalMetrics(_ size: CGFloat) -> (ascent: CGFloat, descent: CGFloat) {
        let font = roundedFont(size: size)
        return (CTFontGetAscent(font), CTFontGetDescent(font))
    }

    var body: some View {
        GeometryReader { proxy in
            let layout = Layout(size: proxy.size)
            let face = layout.face
            let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            let minutes = Double(fixtureTime(date, format: "m"))! + seconds / 60
            let hours = Double(fixtureTime(date, format: "h"))! + minutes / 60
            ZStack(alignment: .topLeading) {
                // Glyph tops/bottoms, measured from the reference as fractions of the face height.
                numeral("12", layout, alignment: .center, glyphTop: face.minY + face.height * 0.07)
                numeral("9", layout, alignment: .leading, glyphTop: face.minY + face.height * 0.47 - layout.digitHeight / 2)
                numeral("3", layout, alignment: .trailing, glyphTop: face.minY + face.height * 0.47 - layout.digitHeight / 2)
                numeral("6", layout, alignment: .center, glyphTop: face.minY + face.height * 0.975 - layout.digitHeight)
                if !numeralsOnly {
                    Text(fixtureTime(date, format: "h:mm"))
                        .font(.system(size: max(17, face.height * 0.042), weight: .semibold))
                        .monospacedDigit().foregroundStyle(ink)
                        .frame(width: face.width - 2 * layout.inset, alignment: .trailing)
                        .position(x: face.midX, y: face.minY + face.height * 0.915)
                    Text(fixtureTime(date, format: "EEE d").uppercased())
                        .font(.system(size: max(17, face.height * 0.042), weight: .semibold))
                        .foregroundStyle(ink).fixedSize()
                        .frame(width: face.width - 2 * layout.inset, alignment: .leading)
                        .position(x: face.midX, y: face.minY + face.height * 0.07)
                    hands(layout, hours: hours, minutes: minutes, seconds: seconds)
                }
            }.frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }

    private func numeral(_ text: String, _ layout: Layout, alignment: Alignment, glyphTop: CGFloat) -> some View {
        let metrics = Self.verticalMetrics(layout.fontSize)
        let baseline = glyphTop + layout.digitHeight
        return Text(text)
            .font(.system(size: layout.fontSize, weight: Self.weight, design: .rounded))
            .foregroundStyle(ink).fixedSize()
            .frame(width: layout.face.width - layout.inset * 2, height: metrics.ascent + metrics.descent, alignment: alignment)
            .offset(x: layout.face.minX + layout.inset, y: baseline - metrics.ascent)
    }

    private func hands(_ layout: Layout, hours: Double, minutes: Double, seconds: Double) -> some View {
        let w = layout.handWidth
        return ZStack {
            hand(length: layout.hourLength, width: w, degrees: hours * 30)
            hand(length: layout.minuteLength, width: w, degrees: minutes * 6)
            Circle().fill(handColor).frame(width: w * 1.5, height: w * 1.5)
            // Thin seconds hand with a short counterweight tail, as in the reference.
            Rectangle().fill(handColor)
                .frame(width: max(1.5, w * 0.16), height: layout.minuteLength * 1.05 + w * 3)
                .offset(y: -(layout.minuteLength * 1.05 - w * 3) / 2)
                .rotationEffect(.degrees(seconds * 6))
            Circle().strokeBorder(handColor, lineWidth: max(1.5, w * 0.16))
                .background(Circle().fill(night ? .black : Self.green))
                .frame(width: w * 0.75, height: w * 0.75)
        }.compositingGroup()
            .shadow(color: .black.opacity(0.32), radius: 5, x: 0, y: 5)
            .frame(width: 0, height: 0).position(layout.center)
    }

    /// HomeView-style hand: a thin neck from the pin, then a full-width rounded blade.
    private func hand(length: CGFloat, width: CGFloat, degrees: Double) -> some View {
        let neck = width * 1.6
        return VStack(spacing: 0) {
            Capsule().fill(handColor).frame(width: width, height: length - neck + width / 2)
            Rectangle().fill(handColor).frame(width: width * 0.36, height: neck - width / 2)
        }.frame(height: length)
            .offset(y: -length / 2).rotationEffect(.degrees(degrees))
    }
}

private struct PanelDuoDial: View {
    let date: Date

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width * 0.29, proxy.size.height * 0.43)
            HStack(spacing: size * 0.035) {
                Text(fixtureTime(date, format: "h"))
                    .foregroundStyle(Color(red: 0.76, green: 0.85, blue: 1))
                Text(fixtureTime(date, format: "mm"))
                    .foregroundStyle(Color(red: 0.40, green: 0.63, blue: 1))
            }
            .font(.system(size: size, weight: .medium, design: .rounded))
            .monospacedDigit()
            .lineLimit(1).minimumScaleFactor(0.55)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a"))
    }
}

private struct PanelSolarDial: View {
    let date: Date
    let night: Bool

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) * 0.80
            let components = Calendar.current.dateComponents([.hour, .minute, .second], from: date)
            let hours = Double(components.hour ?? 0)
            let minutes = Double(components.minute ?? 0)
            let seconds = Double(components.second ?? 0)
            let ink = night ? Color(red: 0.85, green: 0.77, blue: 0.65) : Color(red: 0.22, green: 0.15, blue: 0.10)
            ZStack {
                Circle().fill(night ? Color(white: 0.11) : Color(red: 0.94, green: 0.88, blue: 0.76))
                    .overlay {
                        LinearGradient(colors: [.white.opacity(0.20), .clear, .black.opacity(0.18)],
                            startPoint: .topLeading, endPoint: .bottomTrailing)
                            .rotationEffect(.degrees(hours * 15)).clipShape(.circle)
                    }
                ForEach(0..<60) { index in
                    Capsule().fill(ink.opacity(index.isMultiple(of: 5) ? 0.9 : 0.25))
                        .frame(width: index.isMultiple(of: 5) ? 4 : 2, height: index.isMultiple(of: 5) ? 23 : 8)
                        .offset(y: -side * 0.45)
                        .rotationEffect(.degrees(Double(index) * 6))
                }
                hand(length: side * 0.25, width: 12, color: ink, angle: (hours + minutes / 60) * 30)
                hand(length: side * 0.38, width: 8, color: ink, angle: (minutes + seconds / 60) * 6)
                hand(length: side * 0.40, width: 3, color: .orange, angle: seconds * 6)
                Circle().fill(.orange).frame(width: 14, height: 14)
            }.frame(width: side, height: side)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(night ? Color.black : Color(red: 0.78, green: 0.71, blue: 0.61))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a"))
    }

    private func hand(length: CGFloat, width: CGFloat, color: Color, angle: Double) -> some View {
        Capsule().fill(color).frame(width: width, height: length)
            .offset(y: -length / 2).rotationEffect(.degrees(angle))
    }
}

/// A timer-style clock. The tick ring marks the minutes and the arc tracks the hour.
private struct PanelRingDial: View {
    let date: Date
    private let ink = Color(red: 1, green: 0.64, blue: 0.36)

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) * 0.87
            let minute = Double(Calendar.current.component(.minute, from: date))
            let second = Double(Calendar.current.component(.second, from: date))
            ZStack {
                ForEach(0..<60) { index in
                    Capsule().fill(ink.opacity(index.isMultiple(of: 5) ? 0.75 : 0.3))
                        .frame(width: index.isMultiple(of: 5) ? 4 : 2, height: index.isMultiple(of: 5) ? 19 : 8)
                        .offset(y: -side / 2 + 10)
                        .rotationEffect(.degrees(Double(index) * 6))
                }
                Circle().trim(from: 0, to: (minute + second / 60) / 60)
                    .stroke(ink, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: side - 52, height: side - 52)
                Text(fixtureTime(date, format: "h:mm"))
                    .font(.system(size: side * 0.25, weight: .medium, design: .rounded))
                    .monospacedDigit().foregroundStyle(ink)
            }.frame(width: side, height: side)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a"))
    }
}

/// The dial uses real glyph outlines so the system can lens around each numeral.
private struct PanelGlassClockFace: View {
    let date: Date

    var body: some View {
        GeometryReader { proxy in
            let time = fixtureTime(date, format: "h:mm")
            let box = CGRect(x: proxy.size.width * 0.075, y: proxy.size.height * 0.21,
                width: proxy.size.width * 0.85, height: proxy.size.height * 0.58)
            ZStack {
                Image("ForestPhoto").resizable().scaledToFill()
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                Color.black.opacity(0.48)
                GlassEffectContainer(spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(ClockGlassGlyph.layout(time, in: box).enumerated()), id: \.offset) { _, glyph in
                            Color.clear
                                .frame(width: glyph.frame.width, height: glyph.frame.height)
                                .glassEffect(material, in: glyph.shape)
                                .position(x: glyph.frame.midX, y: glyph.frame.midY)
                        }
                    }.frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a"))
    }

    private var material: Glass {
        #if DEBUG
        if UserDefaults.standard.string(forKey: "previewClockGlass") == "regular" { return .regular }
        #endif
        return .clear
    }
}

private struct ClockGlassGlyph {
    let frame: CGRect
    let shape: Outline

    struct Outline: Shape {
        let path: Path
        func path(in rect: CGRect) -> Path {
            path.offsetBy(dx: rect.minX, dy: rect.minY)
        }
    }

    static func layout(_ text: String, in box: CGRect) -> [Self] {
        let font = CTFontCreateUIFontForLanguage(.system, 100, nil)!
        let line = CTLineCreateWithAttributedString(NSAttributedString(
            string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
        ))
        var paths: [CGPath] = []
        var bounds = CGRect.null
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
            let count = CTRunGetGlyphCount(run)
            var glyphs = Array(repeating: CGGlyph(), count: count)
            var positions = Array(repeating: CGPoint.zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
            for (glyph, position) in zip(glyphs, positions) {
                var translation = CGAffineTransform(translationX: position.x, y: position.y)
                guard let path = CTFontCreatePathForGlyph(font, glyph, nil)?.copy(using: &translation) else { continue }
                let outline = path.normalized()
                bounds = bounds.union(outline.boundingBoxOfPath)
                paths.append(outline)
            }
        }
        guard bounds.width > 0, bounds.height > 0 else { return [] }
        let scale = min(box.width / bounds.width, box.height / bounds.height)
        let transform = CGAffineTransform(a: scale, b: 0, c: 0, d: -scale,
            tx: box.midX - bounds.midX * scale, ty: box.midY + bounds.midY * scale)
        return paths.map { outline in
            let path = Path(outline).applying(transform)
            let frame = path.boundingRect
            return Self(frame: frame, shape: Outline(path: path.offsetBy(dx: -frame.minX, dy: -frame.minY)))
        }
    }
}
