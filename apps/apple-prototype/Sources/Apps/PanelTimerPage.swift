import SwiftUI
import PanelKit

struct PanelTimerPage: View {
    let timer: PanelTimerStore
    @State private var editing = false
    @State private var hours = 0
    @State private var minutes = 15
    @State private var seconds = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            TimerTickRing(countdown: timer.countdown).padding(TimerTickRing.edgeInset)
            if editing { durationEditor }
            else { face }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black).foregroundStyle(.white).tint(.orange)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("timer-page")
    }
    private var face: some View {
        GeometryReader { proxy in
            ZStack {
                // The readout and smooth ring have independent clocks. A paused ring
                // must never pause the readout's schedule after navigation or resume.
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let remaining = timer.countdown.remaining(at: context.date)
                    let phase = timer.countdown.phase
                    VStack(spacing: 24) {
                        Spacer(minLength: 0)
                        Text(phase == .finished ? "Time’s up" : phase == .paused ? "Paused" : "")
                            .font(.system(size: 24, weight: .medium)).foregroundStyle(.white.opacity(0.5))
                            .frame(height: 30)
                            .accessibilityIdentifier("timer-status")
                        Text(Self.readout(remaining))
                            .font(.system(size: min(proxy.size.width * 0.18, 210), weight: .medium, design: .rounded))
                            .monospacedDigit().fontWidth(.condensed)
                            .contentTransition(.numericText(countsDown: true))
                            .minimumScaleFactor(0.6).lineLimit(1)
                            .accessibilityIdentifier("timer-remaining")
                            .accessibilityLabel("Time remaining")
                            .accessibilityValue(Self.accessibleDuration(remaining))
                        Button { editDuration() } label: {
                            Text(Self.durationLabel(timer.countdown.duration))
                                .font(.system(size: 28, weight: .medium)).foregroundStyle(.orange)
                                .frame(minWidth: 140, minHeight: 56).contentShape(.rect)
                        }.buttonStyle(TimerDurationStyle()).accessibilityIdentifier("timer-edit")
                            .accessibilityHint("Changes the timer duration")
                            .disabled(phase != .ready)
                        Spacer(minLength: 0)
                        controls.offset(y: -20)
                        if let message = timer.alertMessage {
                            Text(message).font(.callout).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center).frame(maxWidth: 620)
                        }
                    }.padding(.horizontal, 100).padding(.vertical, 86)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }.id(timer.countdown.phase)
            }
        }
    }
    private var controls: some View {
        GlassEffectContainer(spacing: 24) {
            HStack(spacing: 24) {
                if timer.countdown.phase == .finished {
                    Button { timer.reset() } label: {
                        Label("Stop", systemImage: "stop.fill")
                            .font(.title3.weight(.semibold))
                            .padding(.horizontal, 20).frame(height: 64)
                            .foregroundStyle(.black)
                    }.buttonStyle(.glassProminent).buttonBorderShape(.capsule)
                        .accessibilityIdentifier("timer-stop")
                } else {
                    Button { timer.reset() } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .labelStyle(.iconOnly).font(.system(size: 28, weight: .medium)).frame(width: 64, height: 64)
                    }.buttonStyle(.glass).buttonBorderShape(.circle).disabled(timer.countdown.phase == .ready)
                        .accessibilityIdentifier("timer-reset")
                    Button {
                        if timer.countdown.phase == .running { timer.pause() }
                        else { timer.start() }
                    } label: {
                        Label(primaryTitle, systemImage: timer.countdown.phase == .running ? "pause.fill" : "play.fill")
                            .labelStyle(.iconOnly).font(.system(size: 30, weight: .semibold)).frame(width: 64, height: 64)
                            .foregroundStyle(.black)
                    }.buttonStyle(.glassProminent).buttonBorderShape(.circle).accessibilityIdentifier("timer-start-pause")
                }
            }
        }
    }
    private var primaryTitle: String {
        switch timer.countdown.phase {
        case .running: "Pause"
        case .paused: "Resume"
        case .finished: "Stop"
        case .ready: "Start"
        }
    }
    private func editDuration() {
        let total = Int(timer.countdown.duration)
        hours = total / 3600; minutes = total / 60 % 60; seconds = total % 60
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { editing = true }
    }
    private var durationEditor: some View {
        VStack(spacing: 40) {
            Text("Set Timer").font(.largeTitle.weight(.semibold))
            HStack(spacing: 40) {
                durationWheel("Hours", selection: $hours, range: 0..<24)
                durationWheel("Minutes", selection: $minutes, range: 0..<60)
                durationWheel("Seconds", selection: $seconds, range: 0..<60)
            }
            HStack(spacing: 16) {
                ForEach([5, 15, 30], id: \.self) { value in
                    Button("\(value) min") { hours = 0; minutes = value; seconds = 0 }
                        .accessibilityIdentifier("timer-preset-\(value)")
                }
            }.buttonStyle(.glass).controlSize(.large)
            HStack(spacing: 24) {
                Button("Cancel") { editing = false }.buttonStyle(.glass)
                    .accessibilityIdentifier("timer-edit-cancel")
                Button {
                    timer.setDuration(Double(hours * 3600 + minutes * 60 + seconds))
                    editing = false
                } label: { Text("Done").foregroundStyle(.black) }
                .buttonStyle(.glassProminent).disabled(hours + minutes + seconds == 0)
                    .accessibilityIdentifier("timer-edit-save")
            }.font(.title3.weight(.semibold)).controlSize(.extraLarge)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private func durationWheel(_ title: String, selection: Binding<Int>, range: Range<Int>) -> some View {
        VStack(spacing: 12) {
            Text(title).font(.title3).foregroundStyle(.secondary)
            Picker(title, selection: selection) {
                ForEach(range, id: \.self) { Text("\($0)").tag($0) }
            }
            #if os(iOS)
            .pickerStyle(.wheel)
            #endif
            .labelsHidden().font(.title).frame(width: 160, height: 220)
                .accessibilityIdentifier("timer-\(title.lowercased())")
        }
    }
    static func readout(_ remaining: TimeInterval) -> String {
        let total = max(0, Int(ceil(remaining)))
        if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
    static func durationLabel(_ duration: TimeInterval) -> String {
        let total = Int(duration)
        var parts: [String] = []
        if total >= 3600 { parts.append("\(total / 3600) HR") }
        if total / 60 % 60 > 0 { parts.append("\(total / 60 % 60) MIN") }
        if total % 60 > 0 { parts.append("\(total % 60) SEC") }
        return parts.joined(separator: " ")
    }
    static func accessibleDuration(_ duration: TimeInterval) -> String {
        let total = max(0, Int(ceil(duration)))
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = [.hour, .minute, .second]
        return formatter.string(from: TimeInterval(total)) ?? "0 seconds"
    }
}

/// Original duration remains readable even while editing is disabled.
private struct TimerDurationStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.65 : 1)
    }
}

private struct TimerTickRing: View {
    static let edgeInset: CGFloat = 12
    let countdown: PanelCountdown
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: countdown.phase != .running)) { context in
            CountdownTicks(fraction: countdown.remaining(at: context.date) / countdown.duration,
                ringing: countdown.phase == .finished, tickLength: 22, lineWidth: 7,
                cornerRadius: PanelSurface.cornerRadius - Self.edgeInset,
                cornerFanTicks: 10, smoothProgress: true)
        }
    }
}
