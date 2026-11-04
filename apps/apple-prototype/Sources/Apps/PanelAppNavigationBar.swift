import SwiftUI

/// Fixed navigation chrome, outside each app's scrollable content.
struct PanelAppNavigationBar: View {
    let back: () -> Void
    var body: some View {
        HStack {
            Button(action: back) {
                Label("Back", systemImage: "chevron.backward")
                    .font(.headline).frame(minWidth: 100, minHeight: 48)
            }.buttonStyle(.glass).accessibilityIdentifier("app-back")
                .accessibilityHint("Returns to apps")
            Spacer()
        }.padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 8)
            .background(Color.black)
    }
}
