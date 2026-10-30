import SwiftUI

struct ClassicHomeButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Home", systemImage: "chevron.backward")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minWidth: 88, minHeight: 56)
        }
        .buttonStyle(.glass)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .accessibilityIdentifier("classic-home")
        .padding(16)
    }
}
