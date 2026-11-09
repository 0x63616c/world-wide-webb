import SwiftUI
import UIKit

extension PanelCanvasProfile {
    var sizeClass: UserInterfaceSizeClass { self == .duoClosed ? .compact : .regular }
}

extension EnvironmentValues {
    @Entry var panelCanvasProfile: PanelCanvasProfile = .iPad
    @Entry var panelContentInsets = EdgeInsets()
}

/// Read system obstructions outside the full-bleed surface, then lay out every
/// page at its chosen canvas size before any gesture or transition transforms.
/// Keep one content subtree so opening the Duo preserves navigation and state.
struct PanelCanvas<Content: View>: View {
    @ViewBuilder var content: (PanelCanvasProfile) -> Content

    var body: some View {
        GeometryReader { safeArea in
            GeometryReader { display in
                let profile = PanelCanvasProfile.resolve(size: display.size)
                content(profile)
                    .frame(width: profile.size.width, height: profile.size.height)
                    .environment(\.panelCanvasProfile, profile)
                    .environment(\.horizontalSizeClass, profile.sizeClass)
                    .environment(\.panelContentInsets, profile == .iPad ? EdgeInsets() : safeArea.safeAreaInsets)
                    .clipped()
                    .position(x: display.size.width / 2, y: display.size.height / 2)
                    .background { CanvasOrientation(profile: profile).allowsHitTesting(false) }
            }
            .ignoresSafeArea()
        }
        .background(.black)
    }
}

/// Apply orientation only to the scene containing this canvas. Keeping both
/// orientations in Info.plist allows the Duo to fill either physical display.
private struct CanvasOrientation: UIViewRepresentable {
    let profile: PanelCanvasProfile

    func makeUIView(context: Context) -> OrientationView { OrientationView() }
    func updateUIView(_ view: OrientationView, context: Context) {
        view.profile = profile
        view.applyOrientation()
    }

    final class OrientationView: UIView {
        var profile = PanelCanvasProfile.iPad
        override func didMoveToWindow() {
            super.didMoveToWindow()
            applyOrientation()
        }
        func applyOrientation() {
            guard let scene = window?.windowScene else { return }
            let portrait = profile == .duoClosed
            guard
                portrait
                    ? scene.effectiveGeometry.interfaceOrientation != .portrait
                    : !scene.effectiveGeometry.interfaceOrientation.isLandscape
            else {
                return
            }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: portrait ? .portrait : .landscape))
        }
    }
}

/// Foreground controls honor the phone's actual camera and gesture insets;
/// the complete page surface still occupies the fixed, full-screen canvas.
struct AppCanvasPage<Content: View>: View {
    @Environment(\.panelContentInsets) private var contentInsets
    @ViewBuilder var content: Content

    var body: some View {
        content.safeAreaPadding(contentInsets).background(.black)
    }
}
