import SwiftUI
import PanelKit

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
                LegacyPanelAppIcon(app: app, side: side)
            }
        }.accessibilityHidden(true)
    }
}

/// Icon artwork is separate from the app registration and navigation shell.
private struct LegacyPanelAppIcon: View {
    let app: PanelAppDefinition
    let side: CGFloat
    private var accent: Color { Color(hex: app.accent) }
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: side * 0.23)
                .fill(LinearGradient(colors: [accent.mix(with: .white, by: 0.18), accent, accent.mix(with: .black, by: 0.3)], startPoint: .topLeading, endPoint: .bottomTrailing))
            if app.id == "calendar" {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    VStack(spacing: 0) {
                        Text(context.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                            .font(.system(size: side * 0.14, weight: .bold)).foregroundStyle(.red)
                        Text(context.date.formatted(.dateTime.day()))
                            .font(.system(size: side * 0.49, weight: .light)).foregroundStyle(.black)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.white)
                }.clipShape(.rect(cornerRadius: side * 0.23))
            } else {
                Image(systemName: app.symbol).font(.system(size: side * 0.46, weight: .medium))
                    .symbolRenderingMode(.hierarchical).foregroundStyle(.white.gradient)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 3)
            }
        }.frame(width: side, height: side)
            .overlay { RoundedRectangle(cornerRadius: side * 0.23).strokeBorder(.white.opacity(0.18), lineWidth: 0.5) }
            .accessibilityHidden(true)
    }
}

