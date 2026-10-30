import SwiftUI

struct PresenceClockFace: View {
    let store: any HomeDataSource
    @Binding var near: Bool
    let open: (HomeTile) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                Color(hex: "#43a66a")
                TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30)) { _ in
                    GreenClockDial(date: store.now)
                }.allowsHitTesting(false)
                Color.clear.contentShape(Rectangle()).onTapGesture { togglePresence() }
                    .accessibilityLabel(near ? "Hide clock complications" : "Show clock complications")
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { togglePresence() }
                if near {
                    VStack {
                        HStack {
                            complication(symbol: "thermometer.medium", value: "\(store.climate.ambient)°", label: "Climate", detail: store.climate.action, tile: .climate)
                            Spacer()
                            complication(symbol: "cloud.sun.fill", value: "\(store.weather.temperature)°", label: "Weather", detail: store.weather.condition, tile: .weather)
                        }
                        Spacer()
                        HStack {
                            complication(symbol: "lamp.table.fill", value: store.lamps.anyOn ? "On" : "Off", label: "Lamps", detail: "\(store.lamps.on.filter { $0 }.count) lamps on", tile: .lamps)
                            Spacer()
                            complication(symbol: "wifi", value: "Guest", label: "Wi-Fi", detail: store.wifi.ssid ?? "Not configured", tile: .wifi)
                        }
                    }.padding(.horizontal, 44).padding(.top, 44).padding(.bottom, 92)
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    VStack {
                        Spacer()
                        Button { open(.alarm) } label: {
                            Label(alarmCaption, systemImage: "alarm.fill")
                                .font(.system(size: 23, weight: .semibold))
                                .padding(.horizontal, 24).frame(height: 56)
                        }.buttonStyle(.plain)
                            .background(.black.opacity(0.28), in: .capsule)
                            .glassEffect(.clear.interactive(), in: .capsule)
                            .accessibilityLabel("Open next alarm, \(alarmCaption)")
                            .padding(.bottom, 83)
                    }.transition(.opacity)
                }
                Text(fixtureTime(store.now, format: "EEE d").uppercased())
                    .font(.system(size: 25, weight: .semibold)).foregroundStyle(.black.opacity(0.8))
                    .position(x: size.width * 0.11, y: size.height - 38)
                    .allowsHitTesting(false)
            }.clipped()
        }.ignoresSafeArea()
    }
    private var alarmCaption: String {
        guard let next = store.upcomingAlarm(at: store.now) else { return "No upcoming alarms" }
        return next.ringing ? "\(next.alarm.label) · Ringing" : "\(next.alarm.label) · \(next.alarm.time)"
    }
    private func togglePresence() {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.24)) { near.toggle() }
    }
    private func complication(symbol: String, value: String, label: String, detail: String, tile: HomeTile) -> some View {
        Button { open(tile) } label: {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .center, spacing: 14) {
                    Image(systemName: symbol).font(.system(size: 33))
                    Text(value).font(.system(size: 53, weight: .medium)).lineLimit(1)
                }
                Text(label).font(.system(size: 26, weight: .semibold))
                Text(detail).font(.system(size: 20)).opacity(0.75).lineLimit(1)
            }.frame(width: 238, alignment: .leading).padding(26)
                .background(.black.opacity(0.40), in: .rect(cornerRadius: 42))
                .glassEffect(.clear.interactive(), in: .rect(cornerRadius: 42))
                .overlay(RoundedRectangle(cornerRadius: 42).strokeBorder(.white.opacity(0.22), lineWidth: 0.8))
        }.buttonStyle(.plain).foregroundStyle(.white)
            .accessibilityLabel("\(label), \(value), \(detail)")
    }
}

private struct GreenClockDial: View {
    let date: Date
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            let minutes = Double(fixtureTime(date, format: "m"))! + seconds / 60
            let hours = Double(fixtureTime(date, format: "h"))! + minutes / 60
            ZStack {
                numeral("12", size: h * 0.61, x: w * 0.5, y: h * 0.21)
                numeral("9", size: h * 0.66, x: w * 0.16, y: h * 0.48)
                numeral("3", size: h * 0.66, x: w * 0.84, y: h * 0.48)
                numeral("6", size: h * 0.65, x: w * 0.5, y: h * 0.84)
                hand(length: h * 0.27, width: 22, degrees: hours * 30)
                hand(length: h * 0.40, width: 18, degrees: minutes * 6)
                hand(length: h * 0.43, width: 2, degrees: seconds * 6).opacity(0.7)
                Circle().fill(.white).frame(width: 30, height: 30)
                Circle().fill(Color(hex: "#24533a")).frame(width: 10, height: 10)
            }.frame(width: w, height: h).clipped()
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }
    private func numeral(_ text: String, size: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        Text(text).font(.system(size: size, weight: .ultraLight)).tracking(text.count > 1 ? -size * 0.06 : 0)
            .padding(.trailing, text.count > 1 ? size * 0.06 : 0)
            .foregroundStyle(Color(hex: "#07190d")).fixedSize().position(x: x, y: y)
    }
    private func hand(length: CGFloat, width: CGFloat, degrees: Double) -> some View {
        Capsule().fill(.white).frame(width: width, height: length)
            .offset(y: -length / 2 + 12).rotationEffect(.degrees(degrees))
            .shadow(color: .black.opacity(0.13), radius: 3, y: 3)
    }
}
