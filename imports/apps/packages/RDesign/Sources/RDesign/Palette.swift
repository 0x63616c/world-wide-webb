#if canImport(SwiftUI)
import SwiftUI
#if canImport(UIKit)
import UIKit
public typealias RPlatformColor = UIColor
#else
import AppKit
public typealias RPlatformColor = NSColor
#endif

public extension Color {
    /// A colour that follows the light or dark appearance.
    init(light: RPlatformColor, dark: RPlatformColor) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
        #else
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
        #endif
    }
}

/// The -r family palette: black, white and graphite. No green or teal.
public enum RPalette {
    /// The app icon's near-black tile.
    public static let ink = Color(white: 0.055)
    /// The app icon's near-white glyph.
    public static let paper = Color(white: 0.95)
    public static let background = Color(light: RPlatformColor(white: 0.96, alpha: 1), dark: .black)
    public static let card = Color(light: .white, dark: RPlatformColor(white: 0.065, alpha: 1))
    /// The default accent and the colour for secondary data (weights, charts).
    public static let graphite = Color(light: RPlatformColor(white: 0.28, alpha: 1), dark: RPlatformColor(white: 0.72, alpha: 1))
    public static let hairline = Color.primary.opacity(0.035)
}

#endif
