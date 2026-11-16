import SwiftUI
import UIKit

enum FoldingShape {
  static let cornerRadius: CGFloat = 20
}

enum FoldingSurface {
  static let background = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? .black : UIColor(white: 0.89, alpha: 1)
    })
  static let card = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.065, alpha: 1) : .secondarySystemGroupedBackground
    })
}

enum FoldingTint {
  static let color = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark ? .white : .black
    })
  static let onTint = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark ? .black : .white
    })
}
