import SwiftUI
import UIKit

extension Color {
  /// A colour that follows the light or dark appearance.
  init(light: UIColor, dark: UIColor) {
    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
  }
}

/// Tendr's palette: black, white and graphite. No green or teal.
enum RPalette {
  /// The app icon's near-black tile.
  static let ink = Color(white: 0.055)
  static let background = Color(light: UIColor(white: 0.96, alpha: 1), dark: .black)
  static let card = Color(light: .white, dark: UIColor(white: 0.065, alpha: 1))
  /// The default accent and the colour for secondary data (weights, charts).
  static let graphite = Color(
    light: UIColor(white: 0.28, alpha: 1), dark: UIColor(white: 0.72, alpha: 1))
  static let hairline = Color.primary.opacity(0.035)
}

/// Spacing scale for the shared surfaces in this folder.
enum RSpacing {
  static let xs: CGFloat = 8
  static let s: CGFloat = 12
  static let l: CGFloat = 20
  static let xxl: CGFloat = 32
}

enum RRadius {
  static let card: CGFloat = 24
}
