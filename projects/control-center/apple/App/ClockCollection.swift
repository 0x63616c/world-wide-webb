import SwiftUI
import UIKit

// Five flat-colour faces after the green cardinal face: one solid field, huge
// rounded numerals pushed to the edges, a white moving part and corner complications.

/// What every face can show around the time.
struct ClockInfo {
    var date: String
    var alarm: String? = nil
    var temperature: String? = nil
    var weatherSymbol: String? = nil
    var highLow: String? = nil
    var timer: String? = nil

    var alarmItem: ClockCorners.Item? { alarm.map { .init(text: $0, symbol: "alarm.fill") } }
    /// A running timer takes the place of the current temperature, as on the green face.
    var nowItem: ClockCorners.Item? {
        if let timer { return .init(text: timer, symbol: "timer") }
        return temperature.map { .init(text: $0, symbol: weatherSymbol) }
    }
    var highLowItem: ClockCorners.Item? { highLow.map { .init(text: $0) } }
}

/// Fractional wall-clock components in the panel zone, cheap enough for every frame.
struct ClockTime {
    let seconds: Double
    let minutes: Double
    let hours: Double
    @MainActor init(_ date: Date) {
        let local = date.timeIntervalSince1970 + Double(PanelTimeZone.current.secondsFromGMT(for: date))
        seconds = local.truncatingRemainder(dividingBy: 60)
        minutes = (local / 60).truncatingRemainder(dividingBy: 60)
        hours = (local / 3600).truncatingRemainder(dividingBy: 24)
    }
}

/// Moving parts follow the source's clock at display rate; a still face uses `date`.
struct LiveClockLayer<Content: View>: View {
    let liveClock: (any HomeDataSource)?
    let date: Date
    @ViewBuilder let content: (ClockTime) -> Content
    var body: some View {
        if let liveClock {
            TimelineView(.animation) { _ in content(ClockTime(liveClock.now)) }
        } else {
            content(ClockTime(date))
        }
    }
}

/// Rounded numerals whose layout box is exactly the digit height, so faces can
/// place them by their visible edges. A changed digit rises from below and pushes
/// the old one out of the top: the timer's drop, reversed for counting up.
struct ClockNumeral: View {
    let text: String
    let height: CGFloat
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let metrics: (cap: CGFloat, shift: CGFloat) = {
        let base = UIFont.systemFont(ofSize: 100, weight: .bold)
        let font = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: 100) } ?? base
        // The shift moves the cap box onto the centre of the line box.
        return (font.capHeight / 100, (font.capHeight - font.ascender - font.descender) / 200)
    }()

    var body: some View {
        let size = height / Self.metrics.cap
        HStack(spacing: 0) {
            ForEach(Array(text.enumerated()), id: \.offset) { _, character in
                ZStack {
                    Text(String(character))
                        .id(character)
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .bottom).combined(with: .opacity),
                                removal: .move(edge: .top).combined(with: .opacity)))
                }
                .fixedSize()
                .offset(y: Self.metrics.shift * size)
                // Clip to the digit itself (plus its round overshoot), not the taller line box.
                .frame(height: height * 1.05)
                .clipped()
            }
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .foregroundStyle(color)
        .frame(height: height)
        .animation(reduceMotion ? nil : .spring(duration: 0.45, bounce: 0.35), value: text)
    }
}

/// The four corner complications, on the same lines as the green face.
struct ClockCorners: View {
    struct Item {
        var text: String
        var symbol: String? = nil
    }
    let layout: CardinalClockDial.Layout
    let ink: Color
    var topLeading: Item? = nil
    var topTrailing: Item? = nil
    var bottomLeading: Item? = nil
    var bottomTrailing: Item? = nil

    init(info: ClockInfo, layout: CardinalClockDial.Layout, ink: Color) {
        self.layout = layout
        self.ink = ink
        topLeading = .init(text: info.date)
        topTrailing = info.alarmItem
        bottomLeading = info.nowItem
        bottomTrailing = info.highLowItem
    }

    var body: some View {
        let face = layout.face
        ZStack {
            row(topLeading, .leading, face.minY + face.height * 0.07)
            row(topTrailing, .trailing, face.minY + face.height * 0.07)
            row(bottomLeading, .leading, face.minY + face.height * 0.915)
            row(bottomTrailing, .trailing, face.minY + face.height * 0.915)
        }
    }

    @ViewBuilder private func row(_ item: Item?, _ alignment: Alignment, _ y: CGFloat) -> some View {
        if let item {
            ClockComplication(text: item.text, faceHeight: layout.face.height, ink: ink, symbol: item.symbol)
                .frame(width: layout.face.width - 2 * layout.inset, alignment: alignment)
                .position(x: layout.face.midX, y: y)
        }
    }
}

/// Smoothstep over 0...1, for the short resets at the end of a minute or hour.
private func clockEase(_ progress: Double) -> Double {
    let t = min(1, max(0, progress))
    return t * t * (3 - 2 * t)
}

extension View {
    /// Carries an upright view round a dial, `degrees` clockwise from twelve o'clock.
    /// Rotation is a render transform, so slow movers glide instead of stepping
    /// between the whole pixels that `position` would snap them to.
    fileprivate func orbiting(_ center: CGPoint, radius: CGFloat, degrees: Double) -> some View {
        rotationEffect(.degrees(-degrees)).offset(y: -radius).rotationEffect(.degrees(degrees))
            .position(center)
    }
}

// MARK: - Poster

/// Hours top-left, minutes bottom-right, and a seconds rule filling between them.
struct PosterClockDial: View {
    static let blue = Color(red: 0.20, green: 0.47, blue: 1.0)
    let date: Date
    var night = false
    let info: ClockInfo
    var liveClock: (any HomeDataSource)? = nil
    private var ink: Color { night ? Self.blue : .black }
    var body: some View {
        GeometryReader { proxy in
            let layout = CardinalClockDial.Layout(size: proxy.size)
            let face = layout.face
            let digit = min(face.height * 0.385, face.width * 0.30)
            let edge = face.height * 0.06
            let box = CGSize(width: face.width - 2 * layout.inset, height: face.height - 2 * edge)
            ZStack {
                night ? Color.black : Self.blue
                Group {
                    // Negative padding trims the glyph side bearings and the text's line
                    // box, so numerals and complications share the same optical margins.
                    ClockNumeral(text: fixtureTime(date, format: "h"), height: digit, color: ink)
                        .padding(.horizontal, -digit * 0.055)
                        .frame(width: box.width, height: box.height, alignment: .topLeading)
                    ClockNumeral(text: fixtureTime(date, format: "mm"), height: digit, color: ink)
                        .padding(.horizontal, -digit * 0.055)
                        .frame(width: box.width, height: box.height, alignment: .bottomTrailing)
                    column([.init(text: info.date), info.alarmItem], face: face, alignment: .trailing)
                        .padding(.vertical, -face.height * 0.011)
                        .frame(width: box.width, height: box.height, alignment: .topTrailing)
                    column([info.nowItem, info.highLowItem], face: face, alignment: .leading)
                        .padding(.vertical, -face.height * 0.011)
                        .frame(width: box.width, height: box.height, alignment: .bottomLeading)
                }.position(x: face.midX, y: face.midY)
                LiveClockLayer(liveClock: liveClock, date: date) { time in
                    let thickness = max(6, face.height * 0.011)
                    // Fills for the minute, then drains from the leading end in its last half second.
                    let drain = clockEase((time.seconds - 59.5) / 0.5)
                    let start = box.width * drain
                    let end = max(start + thickness, box.width * min(1, time.seconds / 59.5))
                    Canvas { context, _ in
                        let rule = CGRect(
                            x: face.midX - box.width / 2, y: face.midY - thickness / 2,
                            width: box.width, height: thickness)
                        context.fill(
                            Path(roundedRect: rule, cornerRadius: thickness / 2),
                            with: .color(ink.opacity(night ? 0.3 : 0.16)))
                        let filled = CGRect(
                            x: rule.minX + start, y: rule.minY, width: min(end, box.width) - start,
                            height: thickness)
                        context.fill(Path(roundedRect: filled, cornerRadius: thickness / 2), with: .color(ink))
                    }
                }
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private func column(_ items: [ClockCorners.Item?], face: CGRect, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: face.height * 0.018) {
            ForEach(Array(items.compactMap { $0 }.enumerated()), id: \.offset) { _, item in
                ClockComplication(text: item.text, faceHeight: face.height, ink: ink, symbol: item.symbol)
            }
        }
    }
}

// MARK: - Orbit

/// A black disc with the hour and minute as labelled balls on their own orbits.
struct OrbitClockDial: View {
    static let orange = Color(red: 1.0, green: 0.42, blue: 0.13)
    let date: Date
    var night = false
    let info: ClockInfo
    var liveClock: (any HomeDataSource)? = nil

    var body: some View {
        GeometryReader { proxy in
            let layout = CardinalClockDial.Layout(size: proxy.size)
            let face = layout.face
            let unit = min(face.height, face.width * 0.9)
            let center = CGPoint(x: face.midX, y: face.midY)
            let hourOrbit = unit * 0.165
            let minuteOrbit = unit * 0.345
            let track = Color.white.opacity(0.12)
            ZStack {
                night ? Color.black : Self.orange
                Circle().fill(night ? Color(white: 0.10) : .black)
                    .frame(width: unit * 0.86, height: unit * 0.86).position(center)
                ForEach([hourOrbit, minuteOrbit], id: \.self) { radius in
                    Circle().stroke(track, lineWidth: max(1.5, unit * 0.002))
                        .frame(width: radius * 2, height: radius * 2).position(center)
                }
                Circle().fill(track).frame(width: unit * 0.024, height: unit * 0.024).position(center)
                ClockCorners(info: info, layout: layout, ink: night ? Self.orange : .black)
                LiveClockLayer(liveClock: liveClock, date: date) { time in
                    ZStack {
                        ball(
                            fixtureTime(date, format: "h"), diameter: unit * 0.19, digit: unit * 0.072,
                            fill: night ? Self.orange : .white
                        ).orbiting(center, radius: hourOrbit, degrees: time.hours * 30)
                        ball(
                            fixtureTime(date, format: "mm"), diameter: unit * 0.13, digit: unit * 0.046,
                            fill: night ? Color(white: 0.88) : Self.orange
                        ).orbiting(center, radius: minuteOrbit, degrees: time.minutes * 6)
                        Circle().fill(night ? Self.orange : .white)
                            .frame(width: unit * 0.028, height: unit * 0.028)
                            .orbiting(center, radius: unit * 0.465, degrees: time.seconds * 6)
                    }
                }
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private func ball(_ text: String, diameter: CGFloat, digit: CGFloat, fill: Color) -> some View {
        Circle().fill(fill).frame(width: diameter, height: diameter)
            .overlay { ClockNumeral(text: text, height: digit, color: .black) }
    }
}

// MARK: - Sweep

/// The minute is a colour block sweeping round the hour; ink inverts where it has passed.
struct SweepClockDial: View {
    static let pink = Color(red: 0.98, green: 0.33, blue: 0.52)
    let date: Date
    var night = false
    let info: ClockInfo
    var liveClock: (any HomeDataSource)? = nil

    var body: some View {
        GeometryReader { proxy in
            let layout = CardinalClockDial.Layout(size: proxy.size)
            let face = layout.face
            let unit = min(face.height, face.width * 0.9)
            let center = CGPoint(x: face.midX, y: face.midY)
            let field = night ? Color.black : Self.pink
            let block = night ? Self.pink.mix(with: .black, by: 0.2) : Color.black
            ZStack {
                field
                content(layout, center: center, unit: unit, ink: night ? Self.pink : .black)
                LiveClockLayer(liveClock: liveClock, date: date) { time in
                    let degrees = time.minutes * 6
                    // In the hour's last second the block wipes away clockwise rather than vanishing.
                    let wipe = 360 * clockEase((time.minutes * 60 - 3599) / 1)
                    let wedge = Path { path in
                        path.move(to: center)
                        path.addArc(
                            center: center, radius: proxy.size.width + proxy.size.height,
                            startAngle: .degrees(wipe - 90), endAngle: .degrees(max(wipe, degrees) - 90),
                            clockwise: false)
                        path.closeSubpath()
                    }
                    ZStack {
                        wedge.fill(block)
                        content(layout, center: center, unit: unit, ink: field).mask(wedge)
                        Circle().fill(night ? Color(white: 0.9) : .white)
                            .frame(width: unit * 0.095, height: unit * 0.095)
                            .overlay {
                                ClockNumeral(text: fixtureTime(date, format: "mm"), height: unit * 0.034, color: .black)
                            }
                            .orbiting(center, radius: unit * 0.43, degrees: degrees)
                    }
                }
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private func content(_ layout: CardinalClockDial.Layout, center: CGPoint, unit: CGFloat, ink: Color) -> some View {
        ZStack {
            ClockNumeral(text: fixtureTime(date, format: "h"), height: unit * 0.40, color: ink).position(center)
            ClockCorners(info: info, layout: layout, ink: ink)
        }
    }
}

// MARK: - Tape

/// Two tapes slide under a fixed needle: huge hours above, a minute rule below.
struct TapeClockDial: View {
    static let yellow = Color(red: 1.0, green: 0.80, blue: 0.0)
    let date: Date
    var night = false
    let info: ClockInfo
    var liveClock: (any HomeDataSource)? = nil
    private var ink: Color { night ? Self.yellow : .black }

    var body: some View {
        GeometryReader { proxy in
            let layout = CardinalClockDial.Layout(size: proxy.size)
            let face = layout.face
            let hourPitch = face.width * 0.6
            let minutePitch = face.width * 0.04
            // Half the face is 12.5 minute pitches wide.
            let reach = 14
            let ruleTop = face.minY + face.height * 0.70
            ZStack {
                night ? Color.black : Self.yellow
                LiveClockLayer(liveClock: liveClock, date: date) { time in
                    // Laid-out views snap to whole pixels and would step along; a canvas
                    // draws the slow tapes at fractional positions.
                    Canvas { context, _ in
                        let hour = Int(time.hours.rounded(.down))
                        for value in (hour - 1)...(hour + 1) {
                            context.draw(
                                context.resolve(numeral("\((value + 11) % 12 + 1)", height: face.height * 0.36)),
                                at: CGPoint(
                                    x: face.midX + (Double(value) - time.hours) * hourPitch,
                                    y: face.minY + face.height * 0.43))
                        }
                        let minute = Int(time.minutes.rounded(.down))
                        for value in (minute - reach)...(minute + reach) {
                            let major = value.isMultiple(of: 5)
                            let x = face.midX + (Double(value) - time.minutes) * minutePitch
                            let width = max(2, face.height * (major ? 0.006 : 0.004))
                            let tick = CGRect(
                                x: x - width / 2, y: ruleTop, width: width,
                                height: face.height * (major ? 0.05 : 0.028))
                            context.fill(
                                Path(roundedRect: tick, cornerRadius: width / 2),
                                with: .color(ink.opacity(major ? 1 : 0.45)))
                            if major {
                                let label = String(format: "%02d", (value % 60 + 60) % 60)
                                context.draw(
                                    context.resolve(numeral(label, height: face.height * 0.034)),
                                    at: CGPoint(x: x, y: face.minY + face.height * 0.795))
                            }
                        }
                    }
                }
                Capsule().fill(night ? Color(white: 0.9) : .white)
                    .frame(width: max(6, face.height * 0.01), height: face.height * 0.59)
                    .position(x: face.midX, y: face.minY + face.height * 0.465)
                ClockCorners(info: info, layout: layout, ink: ink)
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }
    }

    private func numeral(_ text: String, height: CGFloat) -> Text {
        Text(text).font(.system(size: height / ClockNumeral.metrics.cap, weight: .bold, design: .rounded))
            .foregroundStyle(ink)
    }
}

// MARK: - Quad

/// One digit per colour tile, with the seconds counted where the four meet.
struct QuadClockDial: View {
    static let tiles = [
        Color(red: 1.0, green: 0.33, blue: 0.20), Color(red: 0.95, green: 0.92, blue: 0.87),
        Color(red: 1.0, green: 0.80, blue: 0.0), Color(red: 0.20, green: 0.47, blue: 1.0),
    ]
    let date: Date
    var night = false
    let info: ClockInfo

    var body: some View {
        GeometryReader { proxy in
            let layout = CardinalClockDial.Layout(size: proxy.size)
            let face = layout.face
            let gap = max(8, face.width * 0.012)
            let tile = CGSize(width: (face.width - 3 * gap) / 2, height: (face.height - 3 * gap) / 2)
            let digits = Array(fixtureTime(date, format: "hhmm")).map(String.init)
            let items: [ClockCorners.Item?] = [
                .init(text: info.date), info.alarmItem, info.nowItem, info.highLowItem,
            ]
            let corners: [Alignment] = [.topLeading, .topTrailing, .bottomLeading, .bottomTrailing]
            ZStack {
                Color.black
                ForEach(0..<4, id: \.self) { index in
                    let ink = night ? Self.tiles[index] : .black
                    ZStack {
                        RoundedRectangle(cornerRadius: min(tile.width, tile.height) * 0.11, style: .continuous)
                            .fill(night ? Color(white: 0.09) : Self.tiles[index])
                        ClockNumeral(text: digits[index], height: tile.height * 0.52, color: ink)
                        if let item = items[index] {
                            ClockComplication(text: item.text, faceHeight: face.height, ink: ink, symbol: item.symbol)
                                .padding(.horizontal, tile.height * 0.09).padding(.vertical, tile.height * 0.07)
                                .frame(width: tile.width, height: tile.height, alignment: corners[index])
                        }
                    }
                    .frame(width: tile.width, height: tile.height)
                    .position(
                        x: face.minX + gap + tile.width / 2 + CGFloat(index % 2) * (tile.width + gap),
                        y: face.minY + gap + tile.height / 2 + CGFloat(index / 2) * (tile.height + gap))
                }
                Circle().fill(.black).frame(width: face.height * 0.14, height: face.height * 0.14)
                    .overlay {
                        ClockNumeral(
                            text: fixtureTime(date, format: "ss"), height: face.height * 0.042,
                            color: night ? Color(white: 0.9) : .white
                        ).monospacedDigit()
                    }
                    .position(x: face.midX, y: face.midY)
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}
