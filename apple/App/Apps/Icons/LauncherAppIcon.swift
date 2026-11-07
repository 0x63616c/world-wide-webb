import PanelKit
import SwiftUI

extension EnvironmentValues {
    @Entry var launcherIconPressed = false
}

/// Pointer position and a button's existing press state drive the artwork only.
/// No additional gesture recognizer competes with scrolling or app activation.
struct LauncherAppIcon: View {
    let app: PanelAppDefinition
    let side: CGFloat
    @Environment(\.launcherIconPressed) private var isPressed
    @State private var pointer: CGSize = .zero

    private var motion: CGSize {
        guard PanelIconArtwork(rawValue: app.id) != nil else { return .zero }
        return isPressed ? CGSize(width: -0.35, height: -0.7) : pointer
    }

    var body: some View {
        PanelAppIcon(app: app, side: side, parallax: motion)
            .rotation3DEffect(.degrees(-motion.height * 4), axis: (x: 1, y: 0, z: 0))
            .rotation3DEffect(.degrees(motion.width * 4), axis: (x: 0, y: 1, z: 0))
            .animation(.smooth(duration: 0.22), value: motion)
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    pointer = CGSize(
                        width: min(1, max(-1, location.x / side * 2 - 1)),
                        height: min(1, max(-1, location.y / side * 2 - 1)))
                case .ended: pointer = .zero
                }
            }
    }
}
