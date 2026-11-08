import SwiftUI
import CallkeepCore

struct MenuPanel: View {
    @Bindable var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var hoveringLibrary = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(AppIdentity.title).font(.headline)
                Spacer()
                Button(action: showSettings) {
                    Image(systemName: "gearshape").frame(width: 26, height: 26)
                }.buttonStyle(.borderless).foregroundStyle(.secondary)
                    .help("Settings").accessibilityLabel("Settings")
            }
            if model.isRecording {
                HStack(spacing: 8) {
                    Circle().fill(.red).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text("Recording").font(.callout)
                    Spacer()
                    Text(Recording.timeString(model.elapsed)).font(.callout.monospacedDigit())
                }
                VStack(spacing: 8) {
                    LiveWaveformView(samples: model.levelHistory).frame(height: 40)
                    WaveformLegend()
                }
            }
            RecordButton(model: model, showsShortcut: true).controlSize(.large)
            if let error = model.errorMessage { Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            Divider()
            Button {
                NSApp.setActivationPolicy(.regular)
                model.showRecordings(); openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "rectangle.stack").frame(width: 20).foregroundStyle(.secondary)
                    Text("Recordings")
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }.padding(.horizontal, 8).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    .background(.primary.opacity(hoveringLibrary ? 0.06 : 0), in: RoundedRectangle(cornerRadius: 7))
            }.buttonStyle(.plain).onHover { hoveringLibrary = $0 }
        }.padding(14).frame(width: 300)
    }
    private func showSettings() {
        NSApp.setActivationPolicy(.regular)
        model.showSettings(); openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true)
    }
}
