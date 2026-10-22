import SwiftUI
import CallkeepCore

struct RecordButton: View {
    @Bindable var model: AppModel
    var body: some View {
        Button { model.toggleRecording() } label: {
            Label(model.isBusy ? "Preparing…" : model.isRecording ? "Stop recording" : "New recording", systemImage: model.isRecording ? "stop.fill" : "record.circle")
        }
        .buttonStyle(.borderedProminent).tint(model.isRecording ? .red : .accentColor)
        .disabled(model.isBusy || model.store == nil)
        .help(model.shortcutEnabled ? "\(model.shortcutLabel) to start or stop" : "Record microphone and computer audio")
    }
}

struct LevelMeter: View {
    let level: Float
    var color: Color = .accentColor
    var body: some View {
        GeometryReader { geometry in
            let fraction = max(0, min(1, (20 * log10(max(Double(level), 0.001)) + 60) / 60))
            HStack(spacing: 3) {
                ForEach(0..<28) { i in
                    Capsule().fill(Double(i) / 28 < fraction ? color : Color.primary.opacity(0.08))
                }
            }.frame(height: min(geometry.size.height, 18))
        }.frame(height: 18)
        .accessibilityLabel("Audio level").accessibilityValue("\(Int(level * 100)) percent")
    }
}

struct ErrorBanner: View {
    let text: String
    let dismiss: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(text).font(.callout).textSelection(.enabled)
            Spacer(minLength: 0)
            Button(action: dismiss) { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss message")
        }.padding(14).background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }
}
