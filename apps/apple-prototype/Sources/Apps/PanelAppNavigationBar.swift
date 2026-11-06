import SwiftUI

enum PanelSurface { static let cornerRadius: CGFloat = 24 }

/// Fixed navigation chrome; the app supplies the background beneath its safe area.
struct PanelAppNavigationBar: View {
    let back: () -> Void
    var body: some View {
        HStack {
            PanelAppBackButton(back: back)
            Spacer()
        }.padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 8)
    }
}

struct PanelAppBackButton: View {
    let back: () -> Void
    var body: some View {
        Button(action: back) {
            Image(systemName: "chevron.left")
                .font(.system(size: 22, weight: .semibold)).frame(width: 48, height: 48)
        }.buttonStyle(.glass).buttonBorderShape(.circle)
            .accessibilityLabel("Back").accessibilityIdentifier("app-back")
            .accessibilityHint("Returns to apps")
    }
}
