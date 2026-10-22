import SwiftUI
import CallkeepCore

struct MenuPanel: View {
    @Bindable var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Callkeep").font(.headline)
                Spacer()
                if model.isRecording {
                    Circle().fill(.red).frame(width: 6, height: 6)
                    Text(Recording.timeString(model.elapsed)).font(.body.monospacedDigit())
                }
            }
            if model.isRecording { WaveformView(peaks: model.levelHistory, progress: 1, live: true).frame(height: 32) }
            HStack { RecordButton(model: model); Spacer(); Text(model.shortcutLabel).font(.caption.monospaced()).foregroundStyle(.secondary) }
            if let error = model.errorMessage { Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            Divider()
            Button { model.showRecordings(); openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true) } label: { Label("Recordings", systemImage: "rectangle.stack") }.buttonStyle(.plain)
            HStack {
                Button { model.showSettings(); openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true) } label: { Label("Settings…", systemImage: "gearshape") }.buttonStyle(.plain)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }.buttonStyle(.plain).foregroundStyle(.secondary)
            }
        }.padding(18).frame(width: 300)
    }
}
