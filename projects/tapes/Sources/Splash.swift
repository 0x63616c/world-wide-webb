// The shared studio splash (`packages/StudioSplash`): spinning globe, WORLD WIDE WEBB and a random
// loading bar, drawn at a whole number of points per art pixel.
import StudioSplash
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
      StudioSplash(pixel: Self.pixel)
    }
    #if os(macOS)
      // Without these the window shows a grey title strip above the black splash.
      .toolbar(removing: .title)
      .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
      // An invisible item keeps the full-height toolbar the library window has, so the window
      // buttons stay put when the splash gives way to the tabs instead of dropping down.
      .toolbar {
        ToolbarItem(placement: .navigation) {
          Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
        }
        .sharedBackgroundVisibility(.hidden)
      }
    #endif
  }
}
