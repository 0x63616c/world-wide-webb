import Foundation
import RDesign

/// Tendr's optional tips. Must match Tendr.storekit and `tips` in apps/tendr/app.yml.
extension RTipJar {
    @MainActor static let tendr = RTipJar(tips: [
        Tip(id: "small", productID: "com.calumwebb.still.tip.small", fallbackName: "Coffee", symbol: "cup.and.saucer.fill"),
        Tip(id: "medium", productID: "com.calumwebb.still.tip.medium", fallbackName: "Croissant", symbol: "fork.knife"),
        Tip(id: "large", productID: "com.calumwebb.still.tip.large", fallbackName: "Gift", symbol: "gift.fill")
    ])
}

/// The public pages for this app on the shared -r site (site/tendr/).
enum AppLinks {
    static let privacy = URL(string: "https://0x63616c.github.io/apps/tendr/privacy/")!
    static let support = URL(string: "https://0x63616c.github.io/apps/tendr/support/")!
}
