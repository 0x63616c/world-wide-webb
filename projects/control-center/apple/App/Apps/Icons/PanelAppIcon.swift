import PanelKit
import SwiftUI

/// One artwork entry point for Home and notification banners/history.
struct PanelAppIcon: View {
    let app: PanelAppDefinition
    let side: CGFloat
    var parallax: CGSize = .zero

    var body: some View {
        Group {
            if let artwork = PanelIconArtwork(rawValue: app.id) {
                PanelIconArtworkView(artwork: artwork, side: side, parallax: parallax)
            } else {
                FallbackPanelAppIcon(app: app, side: side)
            }
        }.accessibilityHidden(true)
    }
}

/// Future registrations remain legible until they receive custom artwork.
private struct FallbackPanelAppIcon: View {
    let app: PanelAppDefinition
    let side: CGFloat
    private var accent: Color { Color(hex: app.accent) }
    var body: some View {
        ZStack {
            LinearGradient(colors: [accent.mix(with: .white, by: 0.25), accent], startPoint: .top, endPoint: .bottom)
            Image(systemName: app.symbol).font(.system(size: side * 0.48, weight: .medium))
                .symbolRenderingMode(.monochrome).foregroundStyle(.white)
        }.frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: side * 0.25, style: .continuous))
    }
}
