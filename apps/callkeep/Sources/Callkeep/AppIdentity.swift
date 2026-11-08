import AppKit

// CI explicitly sets this marker. Local Debug and Release builds stay distinct.
enum AppIdentity {
    static var isProduction: Bool {
        Bundle.main.object(forInfoDictionaryKey: "CallkeepProduction") as? String == "YES"
    }
    static var title: String { isProduction ? "Callkeep" : "Callkeep (Dev)" }
    static var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown version"
        return version + (isProduction ? "" : " · Dev")
    }
    static func configureDock() {
        NSApp.dockTile.badgeLabel = isProduction ? nil : "DEV"
    }
}
