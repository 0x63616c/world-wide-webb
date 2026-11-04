import SwiftUI

struct AlarmRingView: View {
    let store: any HomeDataSource
    let close: () -> Void
    let edit: () -> Void
    var dataCaption = "Fixture data"
    private let orange = Color.orange
    var body: some View {
        TimelineView(.periodic(from: store.now, by: 1)) { _ in
            let now = store.now
            let next = store.upcomingAlarm(at: now)
            GeometryReader { proxy in
                ZStack {
                    Color.black
                    CountdownTicks(fraction: next?.ringFraction(at: now) ?? 0, ringing: next?.ringing ?? false)
                        .padding(AlarmPerimeter.edgeInset - 3)
                    VStack(spacing: 22) {
                        Text(next?.ringing == true ? "Alarm" : next?.snoozed == true ? "Snoozed" : "Next alarm in")
                            .font(.system(size: 28, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                        Text(next.map { countdown($0.remaining(at: now)) } ?? "—")
                            .font(.system(size: min(proxy.size.width * 0.13, 176), weight: .regular, design: .rounded)).monospacedDigit().fontWidth(.condensed)
                            .contentTransition(.numericText())
                        Text(next.map { "\($0.alarm.label) · \($0.alarm.time)" } ?? "No upcoming alarms")
                            .font(.system(size: 34, weight: .medium)).foregroundStyle(orange)
                        if let next, next.ringing, let version = next.version {
                            HStack(spacing: 24) {
                                if let minutes = Int(next.alarm.snoozeMinutes), minutes > 0 {
                                    Button("Snooze · \(minutes) min") { store.send(.snoozeAlarm(next.alarm.id, version)) }
                                        .padding(18).buttonStyle(.glass)
                                }
                                Button("Stop") { store.send(.stopAlarm(next.alarm.id, version)) }
                                    .padding(18).buttonStyle(.glass)
                            }.font(.system(size: 28, weight: .semibold)).padding(.top, 30)
                        } else if next == nil {
                            Button("Set an alarm", action: edit).font(.system(size: 26, weight: .semibold)).buttonStyle(.glass).padding(.top, 30)
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    HStack {
                        CircleButton(symbol: "xmark", label: "Close alarm", size: 64, action: close).accessibilityIdentifier("close-controller")
                        Spacer()
                        Button("Alarms", systemImage: "alarm", action: edit)
                            .font(.system(size: 22, weight: .medium)).buttonStyle(.glass)
                    }.frame(maxHeight: .infinity, alignment: .top).padding(74)
                    Text(dataCaption).font(.system(size: 12)).opacity(0.4)
                        .position(x: proxy.size.width / 2, y: proxy.size.height - 22)
                }.containerShape(.rect(cornerRadius: AlarmPerimeter.faceCornerRadius, style: .circular))
            }
        }.foregroundStyle(.white).tint(orange).ignoresSafeArea()
    }
    private func countdown(_ interval: TimeInterval) -> String {
        let total = max(0, Int(ceil(interval)))
        if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
