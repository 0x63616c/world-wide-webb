import SwiftUI

enum PanelSurface { static let cornerRadius: CGFloat = 24 }

/// Fixed navigation chrome; the app supplies the background beneath its safe area.
struct PanelAppNavigationBar: View {
    let back: () -> Void
    var body: some View {
        HStack {
            Spacer()
            PanelAppBackButton(back: back)
        }.padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 8)
    }
}

struct PanelAppBackButton: View {
    let back: () -> Void
    var respectsCanvasInsets = false
    @Environment(\.panelContentInsets) private var contentInsets
    var body: some View {
        Button(action: back) {
            Image(systemName: "xmark")
                .font(.system(size: 20, weight: .semibold)).frame(width: 48, height: 48)
                .contentShape(.rect)
        }.buttonStyle(.plain)
            .accessibilityLabel("Close").accessibilityIdentifier("app-back")
            .accessibilityHint("Returns to apps")
            .padding(respectsCanvasInsets ? contentInsets : EdgeInsets())
    }
}
