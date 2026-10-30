import SwiftUI

struct PresenceClockFace: View {
    let store: any HomeDataSource
    @Binding var near: Bool
    let open: (HomeTile) -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        GeometryReader { proxy in
            let compact = sizeClass == .compact
            let dialSide = compact ? proxy.size.width - 24 : min(proxy.size.height * (near ? 0.70 : 0.88), proxy.size.width * 0.82)
            ZStack {
                Palette.clock
                VStack(spacing: compact ? 24 : 0) {
                    if compact { Spacer(minLength: 24) }
                    ZStack {
                        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: phase != nil)) { _ in
                            GreenClockDial(date: store.now)
                        }.allowsHitTesting(false)
                        Button { togglePresence() } label: { Color.clear.contentShape(Rectangle()) }
                            .buttonStyle(.plain).accessibilityLabel(near ? "Hide clock complications" : "Show clock complications")
                    }.frame(width: dialSide, height: dialSide)
                    if compact && near {
                        HStack(spacing: 24) {
                            walkComplication
                            Button { open(.tesla) } label: { TeslaChargeComplication(provider: store.tesla, accented: true) }.buttonStyle(.plain)
                        }
                    }
                    if compact { Spacer(minLength: 100) }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).offset(y: compact ? -20 : (near ? -32 : 0))
                if near && !compact {
                    VStack {
                        HStack(alignment: .top) {
                            smallComplication(symbol: "thermometer.medium", value: "\(store.climate.ambient)°", label: "Inside", tile: .climate)
                            Spacer()
                            smallComplication(symbol: "cloud.sun.fill", value: "\(store.weather.temperature)°", label: "Partly cloudy", tile: .weather)
                        }
                        Spacer()
                        HStack(alignment: .bottom) {
                            walkComplication
                            Spacer()
                            Button { open(.tesla) } label: { TeslaChargeComplication(provider: store.tesla, accented: true).frame(width: 180) }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 64).padding(.top, 64).padding(.bottom, 156)
                        .transition(.opacity)
                }
                VStack {
                    Spacer()
                    HStack(alignment: .firstTextBaseline) {
                        if !compact {
                            Text(fixtureTime(store.now, format: "EEE d").uppercased())
                                .font(.system(size: 22, weight: .semibold)).foregroundStyle(.black)
                        }
                        Spacer()
                        if near {
                            Button { open(.alarm) } label: {
                                Label(alarmCaption, systemImage: "alarm.fill")
                                    .font(.system(size: compact ? 17 : 22, weight: .medium))
                            }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, compact ? 24 : 64)
                        .padding(.bottom, compact ? 72 : 88)
                }
            }.clipped()
        }.ignoresSafeArea()
    }
    private var walkComplication: some View {
        Button { open(.dogwalk) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "pawprint.fill").font(.system(size: 28, weight: .medium))
                Text("Zero").font(.system(size: sizeClass == .compact ? 26 : 36, weight: .medium, design: .rounded))
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text(store.walks.activeWalk.map { "Walking · \(walkElapsed($0.duration(at: store.now)))" } ?? store.walks.lastWalkLabel(at: store.now))
                        .font(.system(size: sizeClass == .compact ? 13 : 19)).monospacedDigit().fixedSize()
                }
            }.frame(width: sizeClass == .compact ? 140 : 200, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.white)
    }
    private var alarmCaption: String {
        guard let next = store.upcomingAlarm(at: store.now) else { return "No upcoming alarms" }
        return next.ringing ? "\(next.alarm.label) · Ringing" : "\(next.alarm.label) · \(next.alarm.time)"
    }
    private func togglePresence() {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { near.toggle() }
    }
    private func smallComplication(symbol: String, value: String, label: String, tile: HomeTile) -> some View {
        Button { open(tile) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol).font(.system(size: 28, weight: .medium)).symbolRenderingMode(.monochrome)
                Text(value).font(.system(size: sizeClass == .compact ? 26 : 44, weight: .medium, design: .rounded)).monospacedDigit()
                Text(label).font(.system(size: sizeClass == .compact ? 13 : 20, weight: .regular)).foregroundStyle(.primary)
            }.frame(width: sizeClass == .compact ? 140 : 180, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.white)
            .accessibilityLabel("\(label), \(value)")
    }
}

private struct GreenClockDial: View {
    let date: Date
    var body: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width, proxy.size.height)
            let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            let minutes = Double(fixtureTime(date, format: "m"))! + seconds / 60
            let hours = Double(fixtureTime(date, format: "h"))! + minutes / 60
            ZStack {
                numeral("12", size: s * 0.46, x: s * 0.5, y: s * 0.15)
                numeral("9", size: s * 0.46, x: s * 0.14, y: s * 0.49)
                numeral("3", size: s * 0.46, x: s * 0.86, y: s * 0.49)
                numeral("6", size: s * 0.46, x: s * 0.5, y: s * 0.85)
                hand(length: s * 0.26, width: s * 0.012, degrees: hours * 30)
                hand(length: s * 0.38, width: s * 0.010, degrees: minutes * 6)
                hand(length: s * 0.42, width: max(1.5, s * 0.0028), degrees: seconds * 6).opacity(0.85)
                Circle().fill(.white).frame(width: s * 0.024, height: s * 0.024)
                Circle().fill(.black).frame(width: s * 0.009, height: s * 0.009)
            }.frame(width: s, height: s)
        }.accessibilityElement(children: .ignore).accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
    private func numeral(_ text: String, size: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        Text(text).font(.system(size: size, weight: .ultraLight)).foregroundStyle(.black).fixedSize().position(x: x, y: y)
    }
    private func hand(length: CGFloat, width: CGFloat, degrees: Double) -> some View {
        Capsule().fill(.white).frame(width: width, height: length)
            .offset(y: -length / 2 + width / 2).rotationEffect(.degrees(degrees))
            .shadow(color: .black.opacity(0.12), radius: 2, y: 2)
    }
}
