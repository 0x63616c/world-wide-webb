import SwiftUI

enum PanelSurface { static let cornerRadius: CGFloat = 44 }

/// Fixed navigation chrome, outside each app's scrollable content.
struct PanelAppNavigationBar: View {
    let back: () -> Void
    var fillsBackground = true
    var body: some View {
        HStack {
            Button(action: back) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 22, weight: .semibold)).frame(width: 48, height: 48)
            }.buttonStyle(.glass).buttonBorderShape(.circle)
                .accessibilityLabel("Back").accessibilityIdentifier("app-back")
                .accessibilityHint("Returns to apps")
            Spacer()
        }.padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 8)
            .background { if fillsBackground { Color.black } }
    }
}
