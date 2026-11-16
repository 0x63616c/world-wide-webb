// The studio splash, copied from Control Center (`PanelSplash` in
// `projects/control-center/apple/App/HomeView.swift`): a 41 px, 8-frame looping pixel globe and
// a 7 px wordmark, drawn at a whole number of points per pixel.
import SwiftUI

struct Splash: View {
    #if os(tvOS)
        private static let pixel: CGFloat = 8
    #elseif os(macOS)
        private static let pixel: CGFloat = 6
    #else
        private static let pixel: CGFloat = 4
    #endif

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 4 * Self.pixel) {
                SplashGlobe(side: 41 * Self.pixel)
                Image("StudioWord")
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 61 * Self.pixel, height: 7 * Self.pixel)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("World Wide Webb, loading")
        #if os(macOS)
            // Without these the window shows a grey title strip above the black splash.
            .toolbar(removing: .title)
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        #endif
    }
}

/// Steps through the globe's 8-frame strip at 8 fps by sliding the strip behind a one-frame window.
private struct SplashGlobe: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let side: CGFloat
    private static let start = Date()
    private static let frames = 8

    var body: some View {
        TimelineView(.periodic(from: Self.start, by: 1.0 / 8)) { context in
            let tick = Int(context.date.timeIntervalSince(Self.start) * 8)
            let frame = reduceMotion ? 0 : tick % Self.frames
            Image("StudioGlobe")
                .interpolation(.none)
                .resizable()
                .frame(width: side * CGFloat(Self.frames), height: side)
                .offset(x: -side * CGFloat(frame))
                .frame(width: side, height: side, alignment: .leading)
                .clipped()
        }
        .accessibilityHidden(true)
    }
}
