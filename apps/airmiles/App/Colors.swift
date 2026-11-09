#if canImport(SwiftUI)
import SwiftUI
#if canImport(UIKit)
import UIKit
typealias AMPlatformColor = UIColor
#else
import AppKit
typealias AMPlatformColor = NSColor
#endif

extension Color {
    /// A colour that follows the light or dark appearance.
    init(light: AMPlatformColor, dark: AMPlatformColor) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
        #else
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
        #endif
    }
}


#endif
