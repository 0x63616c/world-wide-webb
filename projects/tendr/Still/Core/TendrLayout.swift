/// Layout depends only on the current window's traits, including during live resize.
/// Kept independent of SwiftUI so the complete trait matrix is testable on Linux.
struct TendrLayout: Equatable {
  enum SizeClass: Equatable { case compact, regular }

  let horizontal: SizeClass?
  let vertical: SizeClass?

  var maximumContentWidth: Double? { horizontal == .regular ? 760 : nil }
  var medicationChartHeight: Double { vertical == .compact ? 180 : 300 }
  var weightChartHeight: Double {
    vertical == .compact ? 180 : horizontal == .regular ? 300 : 220
  }
}
