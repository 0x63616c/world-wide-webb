import CoreText
import PanelKit
import SwiftUI
import UIKit

enum PanelClockFace: String, CaseIterable {
    case green, poster, orbit, sweep, tape, quad
}

/// The clock face, after Apple HomeView's green numeral clock (Apple Newsroom,
/// 13 Oct 2026): a full-bleed green field, four huge black cardinal numerals
/// pushed to the screen edges, white hands and date, time and weather complications.
struct PresenceClockFace: View {
    let store: any HomeDataSource
    var face: PanelClockFace = .green
    /// A running or paused countdown is shown bottom-left on the face.
    var countdown: PanelCountdown? = nil
    @Environment(\.motionPhase) private var phase
    var body: some View {
        // The face itself changes at most once a second; only the hands redraw every frame.
        TimelineView(.animation(minimumInterval: 1, paused: phase != nil)) { _ in
            faceContent(at: store.now)
        }
    }

    // Keep timeline scheduling separate from the content rendered at a known instant.
    func faceContent(at now: Date) -> some View {
        let night =
            !previewDay
            && (previewNight
                || SolarClock.appearanceIsNight(
                    at: now, sunrise: store.weather.sunrise,
                    sunset: store.weather.sunset, nextSunrise: store.weather.nextSunrise,
                    weatherSymbol: store.status(for: .weather) == .live ? store.weather.symbol : nil,
                    calendar: PanelTimeZone.calendar))
        let timer = countdown.flatMap { countdown in
            countdown.phase == .running || countdown.phase == .paused
                ? PanelTimerPage.readout(countdown.remaining(at: now)) : nil
        }
        let weather = store.status(for: .weather) == .live ? store.weather : nil
        let info = ClockInfo(
            date: fixtureTime(now, format: "EEE d MMM").uppercased(),
            alarm: store.upcomingAlarm(at: now).map {
                // Beyond a day the time alone would be ambiguous.
                fixtureTime($0.due, format: $0.due.timeIntervalSince(now) < 86_400 ? "h:mm a" : "EEE h:mm a")
                    .uppercased()
            },
            temperature: weather.map { "\($0.temperature)°" }, weatherSymbol: weather?.symbol,
            highLow: weather.map { "H:\($0.high) L:\($0.low)" }, timer: timer)
        let liveClock = phase == nil ? store : nil
        return ZStack {
            switch face {
            case .green:
                night ? Color.black : CardinalClockDial.green
                CardinalClockDial(date: now, night: night, weather: weather, timer: timer, liveClock: liveClock)
            case .poster: PosterClockDial(date: now, night: night, info: info, liveClock: liveClock)
            case .orbit: OrbitClockDial(date: now, night: night, info: info, liveClock: liveClock)
            case .sweep: SweepClockDial(date: now, night: night, info: info, liveClock: liveClock)
            case .tape: TapeClockDial(date: now, night: night, info: info, liveClock: liveClock)
            case .quad: QuadClockDial(date: now, night: night, info: info)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(now, format: "h:mm a, EEEE MMMM d"))
        .accessibilityIdentifier("clock-face")
    }

    private var previewNight: Bool {
        #if DEBUG
            ProcessInfo.processInfo.arguments.contains("-previewNightClock")
        #else
            false
        #endif
    }

    private var previewDay: Bool {
        #if DEBUG
            ProcessInfo.processInfo.arguments.contains("-previewDayClock")
        #else
            false
        #endif
    }

}

/// Lays the face out in whatever rectangle it is given: landscape fills the
/// whole screen, portrait uses a near-square band so the numerals stay huge.
struct CardinalClockDial: View {
    /// Sampled from the HomeView reference (Apple Newsroom faces image).
    static let green = Color(red: 63.0 / 255, green: 148.0 / 255, blue: 93.0 / 255)
    let date: Date
    var numeralsOnly = false
    var night = false
    var weather: WeatherState?
    var timer: String? = nil
    /// When set, the hands follow this source's clock at display rate instead of `date`.
    var liveClock: (any HomeDataSource)? = nil
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
            fontSize = digitHeight / CardinalClockDial.capHeightRatio
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
    fileprivate static func roundedFont(size: CGFloat) -> CTFont {
        let base = UIFont.systemFont(ofSize: size, weight: .medium)
        let rounded = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) }
        return CTFontCreateWithName((rounded ?? base).fontName as CFString, size, nil)
    }
    @MainActor private static var metricsCache: [CGFloat: (ascent: CGFloat, descent: CGFloat)] = [:]
    @MainActor private static func verticalMetrics(_ size: CGFloat) -> (ascent: CGFloat, descent: CGFloat) {
        if let cached = metricsCache[size] { return cached }
        let font = roundedFont(size: size)
        let metrics = (CTFontGetAscent(font), CTFontGetDescent(font))
        metricsCache[size] = metrics
        return metrics
    }

    var body: some View {
        GeometryReader { proxy in
            let layout = Layout(size: proxy.size)
            let face = layout.face
            ZStack(alignment: .topLeading) {
                // Glyph tops/bottoms, measured from the reference as fractions of the face height.
                numeral("12", layout, alignment: .center, glyphTop: face.minY + face.height * 0.07)
                numeral(
                    "9", layout, alignment: .leading, glyphTop: face.minY + face.height * 0.47 - layout.digitHeight / 2)
                numeral(
                    "3", layout, alignment: .trailing, glyphTop: face.minY + face.height * 0.47 - layout.digitHeight / 2
                )
                numeral("6", layout, alignment: .center, glyphTop: face.minY + face.height * 0.975 - layout.digitHeight)
                if !numeralsOnly {
                    complication(
                        fixtureTime(date, format: "h:mm"), layout: layout, alignment: .trailing,
                        y: face.minY + face.height * 0.07)
                    if let weather {
                        complication(
                            "H:\(weather.high) L:\(weather.low)", layout: layout, alignment: .trailing,
                            y: face.minY + face.height * 0.915)
                    }
                    complication(
                        fixtureTime(date, format: "EEE d MMM").uppercased(), layout: layout, alignment: .leading,
                        y: face.minY + face.height * 0.07)
                    if let timer {
                        ClockComplication(text: timer, faceHeight: layout.face.height, ink: ink, symbol: "timer")
                            .frame(width: layout.face.width - 2 * layout.inset, alignment: .leading)
                            .position(x: layout.face.midX, y: face.minY + face.height * 0.915)
                    }
                    if let liveClock {
                        TimelineView(.animation) { _ in hands(layout, at: liveClock.now) }
                    } else {
                        hands(layout, at: date)
                    }
                }
            }.frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }

    private func complication(_ text: String, layout: Layout, alignment: Alignment, y: CGFloat) -> some View {
        ClockComplication(text: text, faceHeight: layout.face.height, ink: ink)
            .frame(width: layout.face.width - 2 * layout.inset, alignment: alignment)
            .position(x: layout.face.midX, y: y)
    }

    private func numeral(_ text: String, _ layout: Layout, alignment: Alignment, glyphTop: CGFloat) -> some View {
        let metrics = Self.verticalMetrics(layout.fontSize)
        let baseline = glyphTop + layout.digitHeight
        return Text(text)
            .font(.system(size: layout.fontSize, weight: Self.weight, design: .rounded))
            .foregroundStyle(ink).fixedSize()
            .frame(
                width: layout.face.width - layout.inset * 2, height: metrics.ascent + metrics.descent,
                alignment: alignment
            )
            .offset(x: layout.face.minX + layout.inset, y: baseline - metrics.ascent)
    }

    private func hands(_ layout: Layout, at date: Date) -> some View {
        // Wall-clock components in the panel zone, without formatting strings every frame.
        let zone = PanelTimeZone.current
        let local = date.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: date))
        let seconds = local.truncatingRemainder(dividingBy: 60)
        let minutes = (local / 60).truncatingRemainder(dividingBy: 60)
        let hours = (local / 3600).truncatingRemainder(dividingBy: 12)
        let w = layout.handWidth
        return ZStack {
            hand(length: layout.hourLength, width: w, degrees: hours * 30)
            hand(length: layout.minuteLength, width: w, degrees: minutes * 6)
            Circle().fill(handColor).frame(width: w * 1.5, height: w * 1.5)
            // Thin seconds hand with a short counterweight tail, as in the reference.
            Capsule().fill(handColor)
                .frame(width: max(1.5, w * 0.16), height: layout.minuteLength * 1.05 + w * 3)
                .offset(y: -(layout.minuteLength * 1.05 - w * 3) / 2)
                .rotationEffect(.degrees(seconds * 6))
                .modifier(HandShadow())
            Circle().strokeBorder(handColor, lineWidth: max(1.5, w * 0.16))
                .background(Circle().fill(night ? .black : Self.green))
                .frame(width: w * 0.75, height: w * 0.75)
        }
        // Hands follow the timeline directly; never animate a jump to the current time
        // (for example when the clock resumes after an app closes).
        .transaction { $0.animation = nil }
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
            .modifier(HandShadow())
    }

    private struct HandShadow: ViewModifier {
        func body(content: Content) -> some View {
            // Treat each hand as one piece so it can cast a shadow on the one below.
            content.compositingGroup()
                .shadow(color: .black.opacity(0.40), radius: 5, y: 5)
        }
    }
}

struct ClockComplication: View {
    let text: String
    let faceHeight: CGFloat
    let ink: Color
    var symbol: String? = nil

    var body: some View {
        HStack(spacing: faceHeight * 0.012) {
            if let symbol { Image(systemName: symbol) }
            Text(text).monospacedDigit()
        }
        .font(.system(size: max(17, faceHeight * 0.042), weight: .semibold))
        .foregroundStyle(ink)
        .fixedSize()
    }
}
