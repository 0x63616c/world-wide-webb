import SwiftUI
import CallkeepCore

enum VoiceColor {
    static let microphone = Color(red: 0.56, green: 0.48, blue: 1.0)
    static let systemAudio = Color(red: 0.22, green: 0.83, blue: 0.78)
}

struct WaveformLegend: View {
    var body: some View {
        HStack(spacing: 24) {
            item("You", color: VoiceColor.microphone)
            item("Call audio", color: VoiceColor.systemAudio)
        }
    }
    private func item(_ label: String, color: Color) -> some View {
        HStack(spacing: 7) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
        }.accessibilityElement(children: .combine)
    }
}

struct LiveWaveformView: View {
    let samples: [LevelSample]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion)) { _ in
            let now = ProcessInfo.processInfo.systemUptime
            Canvas { context, size in
                // Keep bars legible in the narrow menu, retaining the same 12-second timeline.
                let spacing = size.width / 120
                let width = min(3.5, max(1, spacing - 2))
                for index in 0..<120 {
                    let dot = CGRect(x: Double(index) * spacing, y: size.height / 2 - 1.5, width: width, height: 3)
                    context.fill(Path(roundedRect: dot, cornerRadius: 2), with: .color(.primary.opacity(0.1)))
                }
                if reduceMotion {
                    if let sample = samples.last {
                        for index in -2...2 {
                            draw(sample, x: size.width / 2 + Double(index) * 6 - 2, width: 4,
                                 scale: 1 - Double(abs(index)) * 0.2, entrance: 1, size: size, context: context)
                        }
                    }
                } else {
                    for sample in samples {
                        let age = max(0, now - sample.time)
                        let entrance = min(1, age / 0.1)
                        let eased = entrance * entrance * (3 - 2 * entrance)
                        let x = size.width - age / 0.1 * spacing
                        guard x > -spacing, x < size.width else { continue }
                        draw(sample, x: x, width: width, scale: 1, entrance: eased, size: size, context: context)
                    }
                }
            }.clipped()
        }
        .accessibilityLabel("Live audio: you in purple, call audio in teal")
    }

    private func draw(_ sample: LevelSample, x: Double, width: Double, scale: Double,
                      entrance: Double, size: CGSize, context: GraphicsContext) {
        for (level, color) in [(sample.microphone, VoiceColor.microphone), (sample.systemAudio, VoiceColor.systemAudio)] {
            guard level.isFinite, level > 0.001 else { continue }
            let height = max(3, sqrt(Double(min(level, 1))) * size.height * scale * entrance)
            let rect = CGRect(x: x, y: (size.height - height) / 2, width: width, height: height)
            var layer = context
            // Both sources share a timestamp and centerline. Their overlap blends
            // lighter on dark backgrounds and darker on light backgrounds.
            layer.blendMode = colorScheme == .dark ? .screen : .multiply
            layer.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(color.opacity(0.86 * entrance)))
        }
    }
}
