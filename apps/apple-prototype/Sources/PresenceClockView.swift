import SwiftUI

/// Original watch-inspired composition: the dial is content, not a glass card.
struct PresenceClockFace: View {
    let store: any HomeDataSource
    @Binding var near: Bool
    let open: (HomeTile) -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        GeometryReader { proxy in
            let side = compact ? proxy.size.width - 48 : min(proxy.size.height - 240, proxy.size.width - 608)
            ZStack {
                Color.black
                VStack(spacing: compact ? 40 : 0) {
                    if compact { Spacer(minLength: 32) }
                    Button(action: togglePresence) {
                        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: phase != nil)) { _ in
                            GreenClockDial(date: store.now)
                        }.frame(width: side, height: side).contentShape(.circle)
                    }.buttonStyle(.plain)
                        .accessibilityHint(near ? "Hide complications" : "Show complications")
                    if compact && near {
                        HStack(alignment: .top, spacing: 24) {
                            walkComplication
                            chargeComplication
                        }.padding(.horizontal, 24)
                    }
                    if compact { Spacer(minLength: 100) }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).offset(y: compact ? -16 : -32)
                if near && !compact {
                    VStack {
                        HStack(alignment: .top) {
                            complication(symbol: "thermometer.medium", value: "\(store.climate.ambient)°", label: "Inside", tile: .climate)
                            Spacer()
                            complication(symbol: "cloud.sun.fill", value: "\(store.weather.temperature)°", label: "Partly cloudy", tile: .weather)
                        }
                        Spacer()
                        HStack(alignment: .bottom) {
                            walkComplication
                            Spacer()
                            chargeComplication
                        }
                    }.padding(.horizontal, 80).padding(.top, 112).padding(.bottom, 176)
                        .transition(.opacity)
                }
                VStack {
                    Spacer()
                    HStack(alignment: .firstTextBaseline) {
                        Text(fixtureTime(store.now, format: "EEE d").uppercased())
                        Spacer()
                        if near {
                            Button { open(.alarm) } label: {
                                Label(alarmCaption, systemImage: "alarm.fill")
                            }.buttonStyle(.plain)
                        }
                    }.font(.system(size: compact ? 17 : 22, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, compact ? 24 : 80).padding(.bottom, compact ? 48 : 64)
                }
            }.clipped()
        }.ignoresSafeArea()
    }
    private var walkComplication: some View {
        Button { open(.dogwalk) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "pawprint.fill").font(.system(size: 28)).foregroundStyle(.green)
                Text("Zero").font(.system(size: compact ? 28 : 40, weight: .semibold, design: .rounded))
                TimelineView(.periodic(from: store.now, by: 1)) { _ in
                    Text(store.walks.activeWalk.map { "Walking · \(walkElapsed($0.duration(at: store.now)))" } ?? store.walks.lastWalkLabel(at: store.now))
                        .font(.system(size: compact ? 14 : 20)).monospacedDigit().fixedSize()
                }
            }.frame(width: compact ? 160 : 224, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.white)
    }
    private var chargeComplication: some View {
        Button { open(.tesla) } label: {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    Circle().stroke(.green.opacity(0.20), lineWidth: 5)
                    Circle().trim(from: 0, to: Double(store.tesla.data.pct) / 100)
                        .stroke(.green, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(store.tesla.data.pct)").font(.system(size: 36, weight: .semibold, design: .rounded))
                        Text("%").font(.system(size: 16, weight: .medium))
                    }
                }.frame(width: 96, height: 96)
                Text(store.tesla.data.charging ? "Car · Charging" : "Car")
                    .font(.system(size: compact ? 14 : 20))
            }.frame(width: compact ? 144 : 224, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.white)
    }
    private var alarmCaption: String {
        guard let next = store.upcomingAlarm(at: store.now) else { return "No upcoming alarms" }
        return next.ringing ? "\(next.alarm.label) · Ringing" : "\(next.alarm.label) · \(next.alarm.time)"
    }
    private func togglePresence() {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { near.toggle() }
    }
    private func complication(symbol: String, value: String, label: String, tile: HomeTile) -> some View {
        Button { open(tile) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol).font(.system(size: 28)).foregroundStyle(.green)
                Text(value).font(.system(size: compact ? 28 : 48, weight: .semibold, design: .rounded)).monospacedDigit()
                Text(label).font(.system(size: compact ? 14 : 20))
            }.frame(width: compact ? 144 : 224, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.white).accessibilityLabel("\(label), \(value)")
    }
}

struct GreenClockDial: View {
    let date: Date
    var numeralsOnly = false
    /// Physical clearance, not a ratio alone, also protects the smaller phone dial.
    static func maximumHandLength(side: CGFloat) -> CGFloat { max(0, side * 0.385 - 24) }
    var body: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width, proxy.size.height)
            let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            let minutes = Double(fixtureTime(date, format: "m"))! + seconds / 60
            let hours = Double(fixtureTime(date, format: "h"))! + minutes / 60
            let length = Self.maximumHandLength(side: s)
            ZStack {
                if !numeralsOnly {
                    ForEach(0..<60, id: \.self) { tick in
                        Capsule().fill(tick.isMultiple(of: 5) ? .white : .white.opacity(0.45))
                            .frame(width: tick.isMultiple(of: 5) ? s * 0.005 : s * 0.0025,
                                   height: tick.isMultiple(of: 5) ? s * 0.028 : s * 0.014)
                            .offset(y: -s * 0.48).rotationEffect(.degrees(Double(tick) * 6))
                    }
                }
                numeral("12", side: s, x: 0.50, y: 0.08)
                numeral("3", side: s, x: 0.92, y: 0.50)
                numeral("6", side: s, x: 0.50, y: 0.92)
                numeral("9", side: s, x: 0.08, y: 0.50)
                if !numeralsOnly {
                    hand(length: length * 0.74, width: s * 0.016, degrees: hours * 30, color: .white)
                    hand(length: length, width: s * 0.011, degrees: minutes * 6, color: .white)
                    hand(length: length * 0.98, width: max(1.5, s * 0.003), degrees: seconds * 6, color: .green)
                    Circle().fill(.white).frame(width: s * 0.026, height: s * 0.026)
                    Circle().fill(.green).frame(width: s * 0.012, height: s * 0.012)
                }
            }.frame(width: s, height: s)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
    private func numeral(_ text: String, side: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        Text(text).font(.system(size: side * 0.085, weight: .medium, design: .rounded))
            .foregroundStyle(numeralsOnly ? .black : .green).fixedSize().position(x: side * x, y: side * y)
    }
    private func hand(length: CGFloat, width: CGFloat, degrees: Double, color: Color) -> some View {
        Capsule().fill(color).frame(width: width, height: length)
            .offset(y: -length / 2 + width / 2).rotationEffect(.degrees(degrees))
    }
}
