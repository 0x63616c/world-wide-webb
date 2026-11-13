import Foundation
import RDesign

/// Tendr's optional tips. Must match Tendr.storekit and `tips` in projects/tendr/app.yml.
extension RTipJar {
  @MainActor static let tendr = RTipJar(tips: [
    Tip(
      id: "small", productID: "com.calumwebb.still.tip.small", fallbackName: "Coffee",
      symbol: "cup.and.saucer.fill"),
    Tip(
      id: "medium", productID: "com.calumwebb.still.tip.medium", fallbackName: "Croissant",
      symbol: "fork.knife"),
    Tip(
      id: "large", productID: "com.calumwebb.still.tip.large", fallbackName: "Gift",
      symbol: "gift.fill"),
  ])
}

/// Canonical public privacy and support pages, published from projects/tendr/site.
enum AppLinks {
  static let privacy = URL(string: "https://tendr.worldwidewebb.co/privacy/")!
  static let support = URL(string: "https://tendr.worldwidewebb.co/support/")!
}
