#if DEBUG
import SwiftUI

/// Synthetic, network-free captures. This entire host and its switch disappear in Release.
struct NotificationCapture: View {
    static var state: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-notificationCapture"),
              arguments.indices.contains(index + 1),
              ["single", "stacked", "expanded", "swipe"].contains(arguments[index + 1]) else { return nil }
        return arguments[index + 1]
    }

    @State private var center: NotificationCenter
    private let mode: String

    init() {
        mode = Self.state ?? "single"
        let center = NotificationCenter()
        if mode == "stacked" || mode == "expanded" {
            center.post(sourceModule: "walk", title: "Time for a walk", body: "The afternoon dog walk is ready to start.",
                deepLink: "module/walk")
            center.post(sourceModule: "alarms", title: "Alarm scheduled", body: "Your next alarm is set for tomorrow at 7:00 AM.",
                deepLink: "module/alarms")
        }
        center.post(sourceModule: "updates", title: "Update ready", body: "A new version is available. Open TestFlight to update your panel.",
            deepLink: PanelNotifications.updateDeepLink)
        _center = State(initialValue: center)
    }

    var body: some View {
        Color.black.ignoresSafeArea()
            .overlay {
                NotificationBanners(source: PanelNotifications.source,
                    initiallyExpanded: mode == "expanded", captureDrag: mode == "swipe" ? 125 : 0)
            }
            .environment(center)
            .statusBarHidden()
            .persistentSystemOverlays(.hidden)
    }
}
#endif
