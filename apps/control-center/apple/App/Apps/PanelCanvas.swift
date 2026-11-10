import SwiftUI

extension EnvironmentValues {
    @Entry var panelCanvasProfile: PanelCanvasProfile = .spacious
    @Entry var panelContentInsets = EdgeInsets()
}

/// Measure inside the navigation content so its directional system insets are
/// known before extending the background to the window edges. The same subtree
/// resizes in place when the window changes; navigation and gestures stay alive.
struct PanelCanvas<Content: View>: View {
    @ViewBuilder var content: (CGSize) -> Content

    var body: some View {
        GeometryReader { safeArea in
            GeometryReader { display in
                content(display.size)
                    .frame(width: display.size.width, height: display.size.height)
                    .environment(\.panelCanvasProfile, PanelCanvasProfile.resolve(size: safeArea.size))
                    .environment(\.panelContentInsets, safeArea.safeAreaInsets)
            }
            .ignoresSafeArea()
        }
        .background(.black)
    }
}

/// Backgrounds fill the canvas; foreground controls retain each directional inset.
struct AppCanvasPage<Content: View>: View {
    @Environment(\.panelContentInsets) private var contentInsets
    @ViewBuilder var content: Content

    var body: some View {
        content.safeAreaPadding(contentInsets).background(.black)
    }
}
