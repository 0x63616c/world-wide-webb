import CoreText
import SwiftUI

/// The clock face, after Apple HomeView's green numeral clock (Apple Newsroom,
/// 13 Oct 2026): a full-bleed green field, four huge black cardinal numerals
/// pushed to the screen edges, white hands and a small date. No complications.
struct PresenceClockFace: View {
    let store: any HomeDataSource
    let open: (HomeTile) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        ZStack {
            GreenClockDial.green
            Button { open(.clock) } label: {
                TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: phase != nil)) { _ in
                    GreenClockDial(date: store.now)
                }.contentShape(.rect)
            }.buttonStyle(.plain)
                .accessibilityIdentifier("clock-face")
                .accessibilityHint("Opens alarms")
        }.ignoresSafeArea()
    }
}

/// Lays the face out in whatever rectangle it is given: landscape fills the
/// whole screen, portrait uses a near-square band so the numerals stay huge.
struct GreenClockDial: View {
    /// Sampled from the HomeView reference (Apple Newsroom faces image).
    static let green = Color(red: 63.0 / 255, green: 148.0 / 255, blue: 93.0 / 255)
    let date: Date
    var numeralsOnly = false

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
                    Text(fixtureTime(date, format: "EEE d").uppercased())
                        .font(.system(size: max(17, face.height * 0.042), weight: .semibold))
                        .foregroundStyle(.black).fixedSize()
                        .alignmentGuide(.leading) { _ in -(layout.inset * 1.25) }
                        .alignmentGuide(.top) { d in -(face.minY + face.height * 0.915) + d[.firstTextBaseline] }
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
            .foregroundStyle(.black).fixedSize()
            .frame(width: layout.face.width - layout.inset * 2, height: metrics.ascent + metrics.descent, alignment: alignment)
            .offset(x: layout.face.minX + layout.inset, y: baseline - metrics.ascent)
    }

    private func hands(_ layout: Layout, hours: Double, minutes: Double, seconds: Double) -> some View {
        let w = layout.handWidth
        return ZStack {
            hand(length: layout.hourLength, width: w, degrees: hours * 30)
            hand(length: layout.minuteLength, width: w, degrees: minutes * 6)
            Circle().fill(.white).frame(width: w * 1.5, height: w * 1.5)
            // Thin seconds hand with a short counterweight tail, as in the reference.
            Rectangle().fill(.white)
                .frame(width: max(1.5, w * 0.16), height: layout.minuteLength * 1.05 + w * 3)
                .offset(y: -(layout.minuteLength * 1.05 - w * 3) / 2)
                .rotationEffect(.degrees(seconds * 6))
            Circle().strokeBorder(.white, lineWidth: max(1.5, w * 0.16))
                .background(Circle().fill(Self.green))
                .frame(width: w * 0.75, height: w * 0.75)
        }.frame(width: 0, height: 0).position(layout.center)
    }

    /// HomeView-style hand: a thin neck from the pin, then a full-width rounded blade.
    private func hand(length: CGFloat, width: CGFloat, degrees: Double) -> some View {
        let neck = width * 1.6
        return VStack(spacing: 0) {
            Capsule().fill(.white).frame(width: width, height: length - neck + width / 2)
            Rectangle().fill(.white).frame(width: width * 0.36, height: neck - width / 2)
        }.frame(height: length)
            .offset(y: -length / 2).rotationEffect(.degrees(degrees))
    }
}
