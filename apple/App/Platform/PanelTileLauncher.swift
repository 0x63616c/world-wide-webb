import SwiftUI

/// A preview is presentation only. Give the whole tile one explicit hit region
/// and one accessibility action instead of forwarding taps through its canvas,
/// image or nested preview controls.
struct PanelTileLauncher<Content: View>: View {
    let label: String
    let open: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        Button(action: open) {
            content()
                .allowsHitTesting(false)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}
