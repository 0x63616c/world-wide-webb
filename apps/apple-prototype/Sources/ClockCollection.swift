import SwiftUI

/// Twelve generous hour petals: a clock that reads as a single sculptural flower.
struct PetalClockDial: View {
    let date: Date
    let night: Bool

    private var ink: Color { Color(red: 0.18, green: 0.10, blue: 0.32) }
    private var lavender: Color { Color(red: 0.77, green: 0.68, blue: 1) }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) * 0.94
            ZStack {
                (night ? Color(red: 0.065, green: 0.035, blue: 0.12) : ink)
                ZStack {
                    ForEach(0..<12) { hour in
                        Capsule()
                            .fill(LinearGradient(colors: [lavender, Color(red: 0.49, green: 0.34, blue: 0.79)],
                                startPoint: .top, endPoint: .bottom))
                            .frame(width: side * 0.205, height: side * 0.41)
                            .offset(y: -side * 0.285)
                            .rotationEffect(.degrees(Double(hour) * 30))
                    }
                    ForEach([12, 3, 6, 9], id: \.self) { hour in
                        let angle = Double(hour) * .pi / 6
                        Text(String(hour))
                            .font(.system(size: side * 0.065, weight: .semibold, design: .rounded))
                            .foregroundStyle(ink)
                            .offset(x: sin(angle) * side * 0.405, y: -cos(angle) * side * 0.405)
                    }
                    CollectionClockHands(date: date, side: side, hourColor: .white,
                        minuteColor: .white, secondColor: Color(red: 0.94, green: 1, blue: 0.65),
                        hourLength: 0.25, minuteLength: 0.39)
                }
                .frame(width: side, height: side)
                .opacity(night ? 0.78 : 1)
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
}

/// A sun-like colour field with a fine chapter ring and contrasting ivory hands.
struct SolsticeClockDial: View {
    let date: Date
    let night: Bool
    private var plum: Color { Color(red: 0.20, green: 0.055, blue: 0.12) }
    private var cream: Color { Color(red: 1, green: 0.91, blue: 0.73) }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) * 0.87
            ZStack {
                (night ? Color(red: 0.08, green: 0.025, blue: 0.045) : plum)
                Circle()
                    .fill(LinearGradient(colors: night
                        ? [Color(red: 0.55, green: 0.20, blue: 0.24), Color(red: 0.25, green: 0.055, blue: 0.14)]
                        : [Color(red: 1, green: 0.82, blue: 0.53), Color(red: 1, green: 0.43, blue: 0.38), Color(red: 0.67, green: 0.16, blue: 0.30)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: side, height: side)
                ZStack {
                    ForEach(0..<60) { tick in
                        Capsule().fill(cream.opacity(tick.isMultiple(of: 5) ? 0.95 : 0.5))
                            .frame(width: side * (tick.isMultiple(of: 5) ? 0.005 : 0.002),
                                height: side * (tick.isMultiple(of: 5) ? 0.042 : 0.012))
                            .offset(y: -side * 0.455)
                            .rotationEffect(.degrees(Double(tick) * 6))
                    }
                    Text(fixtureTime(date, format: "d"))
                        .font(.system(size: side * 0.105, weight: .regular, design: .rounded))
                        .foregroundStyle(night ? cream : plum)
                        .offset(y: side * 0.23)
                    CollectionClockHands(date: date, side: side, hourColor: night ? cream.opacity(0.65) : plum,
                        minuteColor: cream, secondColor: cream,
                        hourLength: 0.25, minuteLength: 0.39)
                }.frame(width: side, height: side)
                VStack {
                    HStack {
                        Text(fixtureTime(date, format: "EEEE").uppercased())
                        Spacer()
                        Text(fixtureTime(date, format: "MMM d").uppercased())
                    }
                    Spacer()
                    HStack {
                        Text(fixtureTime(date, format: "h:mm"))
                        Spacer()
                        Text(fixtureTime(date, format: "a"))
                    }
                }
                .font(.system(size: max(17, side * 0.025), weight: .medium, design: .rounded))
                .tracking(2).monospacedDigit().foregroundStyle(cream)
                .padding(side * 0.052)
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
}

/// Oversized stacked numerals and a continuous blue colour field, like a typographic poster.
struct TideClockDial: View {
    let date: Date
    let night: Bool

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let band = min(size.height * 0.40, size.width * 0.47)
            ZStack {
                LinearGradient(colors: [Color(red: 0.025, green: 0.10, blue: 0.27),
                    Color(red: 0.035, green: 0.25, blue: 0.68)], startPoint: .top, endPoint: .bottom)
                Ellipse()
                    .fill(LinearGradient(colors: [Color(red: 0.04, green: 0.27, blue: 0.65),
                        Color(red: 0.04, green: 0.40, blue: 0.70)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: size.width * 1.7, height: size.height * 0.92)
                    .rotationEffect(.degrees(-22))
                    .position(x: size.width * 0.64, y: size.height * 0.99)
                VStack(spacing: band * 0.035) {
                    numerals(fixtureTime(date, format: "hh"), height: band)
                        .foregroundStyle(Color(red: 0.70, green: 0.91, blue: 1))
                    numerals(fixtureTime(date, format: "mm"), height: band)
                        .foregroundStyle(Color(red: 0.64, green: 0.86, blue: 1))
                }
                .offset(y: size.height * 0.015)
                VStack {
                    HStack {
                        Text(fixtureTime(date, format: "EEE, MMM d").uppercased())
                        Spacer()
                        Text(fixtureTime(date, format: "a"))
                    }
                    Spacer()
                }
                .font(.system(size: max(17, min(size.width, size.height) * 0.026), weight: .semibold))
                .tracking(2).foregroundStyle(Color(red: 0.70, green: 0.91, blue: 1))
                .padding(min(size.width, size.height) * 0.052)
                if night { Color.black.opacity(0.32) }
            }.frame(width: size.width, height: size.height).clipped()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }

    private func numerals(_ text: String, height: CGFloat) -> some View {
        Text(text)
            .font(.system(size: height * 1.38, weight: .bold, design: .rounded))
            .monospacedDigit().tracking(-height * 0.065)
            .fixedSize().frame(height: height)
    }
}

/// Shared hand geometry keeps the two new analogue faces on the same continuous timebase.
private struct CollectionClockHands: View {
    let date: Date
    let side: CGFloat
    let hourColor: Color
    let minuteColor: Color
    let secondColor: Color
    let hourLength: CGFloat
    let minuteLength: CGFloat

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        // Match the panel clock’s existing Los Angeles time zone.
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }()

    var body: some View {
        let second = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
        let parts = Self.calendar.dateComponents([.hour, .minute], from: date)
        let minute = Double(parts.minute ?? 0)
        let hour = Double((parts.hour ?? 0) % 12)
        ZStack {
            hand(length: side * hourLength, width: side * 0.025, color: hourColor,
                angle: (hour + minute / 60 + second / 3600) * 30)
            hand(length: side * minuteLength, width: side * 0.016, color: minuteColor,
                angle: (minute + second / 60) * 6)
            Rectangle().fill(secondColor)
                .frame(width: max(1.5, side * 0.0025), height: side * 0.49)
                .offset(y: -side * 0.175).rotationEffect(.degrees(second * 6))
            Circle().fill(secondColor).frame(width: side * 0.025, height: side * 0.025)
            Circle().fill(hourColor).frame(width: side * 0.009, height: side * 0.009)
        }
        .compositingGroup().shadow(color: .black.opacity(0.18), radius: 4, y: 3)
    }

    private func hand(length: CGFloat, width: CGFloat, color: Color, angle: Double) -> some View {
        Capsule().fill(color).frame(width: width, height: length + side * 0.045)
            .offset(y: -(length - side * 0.045) / 2).rotationEffect(.degrees(angle))
    }
}
