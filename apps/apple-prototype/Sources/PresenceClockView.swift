import CoreText
import SwiftUI
import PanelKit

enum PanelClockFace: String, CaseIterable {
    case green, midnight, paper, ember
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
        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: phase != nil)) { _ in
            let now = store.now
            let hour = Calendar.current.component(.hour, from: now)
            let night = previewNight || (SolarClock.isNight(at: now, sunrise: store.weather.sunrise,
                sunset: store.weather.sunset, nextSunrise: store.weather.nextSunrise)
                ?? (store.weather.symbol.contains("moon") || hour < 7 || hour >= 18))
            ZStack {
                switch face {
                case .green:
                    night ? Color.black : GreenClockDial.green
                    GreenClockDial(date: now, night: night)
                case .midnight:
                    Color(red: 0.04, green: 0.07, blue: 0.16)
                    PanelDigitalDial(date: now, ink: Color(red: 0.67, green: 0.78, blue: 1), design: .monospaced)
                case .paper:
                    night ? Color(white: 0.09) : Color(red: 0.92, green: 0.87, blue: 0.77)
                    PanelDigitalDial(date: now, ink: night ? .white : Color(white: 0.15), design: .serif)
                case .ember:
                    Color(red: 0.15, green: 0.05, blue: 0.035)
                    PanelDigitalDial(date: now, ink: Color(red: 1, green: 0.55, blue: 0.31), design: .rounded, stacked: true)
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
    private var ink: Color { night ? Color(white: 0.68) : .black }
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
    static let weight: Font.Weight = .light
    static let capHeightRatio: CGFloat = {
        let font = CTFontCreateUIFontForLanguage(.system, 100, nil)!
        return CTFontGetCapHeight(font) / 100
    }()
    private static func verticalMetrics(_ size: CGFloat) -> (ascent: CGFloat, descent: CGFloat) {
        let font = CTFontCreateUIFontForLanguage(.system, size, nil)!
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
                    Text(fixtureTime(date, format: "h:mm a").uppercased())
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
            .font(.system(size: layout.fontSize, weight: Self.weight))
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

private struct PanelDigitalDial: View {
    let date: Date
    let ink: Color
    let design: Font.Design
    var stacked = false

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width * 0.21, proxy.size.height * (stacked ? 0.25 : 0.38))
            VStack(spacing: stacked ? 0 : 24) {
                if stacked {
                    Text(fixtureTime(date, format: "HH"))
                    Text(fixtureTime(date, format: "mm"))
                } else {
                    Text(fixtureTime(date, format: "HH:mm"))
                }
                Text(date, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.system(size: 24, weight: .medium, design: design))
                    .padding(.top, stacked ? 24 : 0)
            }
            .font(.system(size: size, weight: .light, design: design))
            .monospacedDigit()
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
}
