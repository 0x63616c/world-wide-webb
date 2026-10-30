import Foundation
import SwiftUI
import PanelKit

/// Composition and module identity stay in Hybrid; the inbox has no routing dependency.
@MainActor enum PanelNotifications {
    static func make() -> NotificationCenter {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-hybridFixtures") {
            let center = NotificationCenter()
            if ProcessInfo.processInfo.arguments.contains("-notificationSamples") {
                center.post(sourceModule: "lights", title: "Scene ready", body: "Reading lights are ready.",
                    deepLink: "module/lights", priority: .high, dedupeKey: "scene")
                if ProcessInfo.processInfo.arguments.contains("-notificationStack") {
                    center.post(sourceModule: "lights", title: "Lights updated", body: "The evening scene is ready.",
                        deepLink: "module/lights", priority: .high)
                    center.post(sourceModule: "lights", title: "Reading scene", body: "Your reading scene is ready to open.",
                        deepLink: "module/lights", priority: .high)
                    center.post(sourceModule: "climate", title: "Temperature reached", body: "Climate is ready to review.",
                        deepLink: "module/climate", priority: .critical)
                }
            }
            return center
        }
        #endif
        let config = PanelConfiguration()
        return NotificationCenter(api: NotificationsAPI(client: PanelAPIClient(configuration: PanelKit.PanelConfiguration(
            baseURL: config.serverURL, accessClientID: config.accessHeaders["CF-Access-Client-Id"],
            accessClientSecret: config.accessHeaders["CF-Access-Client-Secret"]))))
    }

    static func open(_ item: NotificationItem, store: LiveHomeDataSource, session: KioskSession,
                     navigation: PanelNavigation, router: HybridRouter) -> Bool {
        guard let module = module(for: item.deepLink) else { return false }
        let ready = store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
        if module == .alarms && router.route(for: module, hasLiveData: ready) == .native(module) {
            navigation.openNativeAlarms()
        } else if module == .alarms {
            navigation.openClassic()
            session.open(URL(string: "controlcenter://alarms")!)
        } else {
            navigation.pendingNativeAlarmLink = false
            navigation.showingHome = false
            navigation.selection = module
            navigation.detail = true
        }
        return true
    }

    static func module(for deepLink: String) -> PanelModule? {
        let segments = deepLink.split(separator: "/", omittingEmptySubsequences: false)
        guard segments.count >= 2, segments.first == "module",
              segments.dropFirst().allSatisfy({ !$0.isEmpty && $0.allSatisfy {
                  $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-")
              } }) else { return nil }
        let id = String(segments[1])
        // Backend feature IDs and panel module IDs intentionally differ.
        switch id {
        case "ctrl": return .lights
        case "ac": return .climate
        case "sound": return .sonos
        case "booth": return .photos
        case "walks": return .walk
        case "events" where segments.count > 2 && segments[2] == "alarms": return .alarms
        default: return PanelModule(rawValue: id).flatMap { $0 == .all ? nil : $0 }
        }
    }

    static func source(_ id: String) -> NotificationSource {
        let module = module(for: "module/\(id)")
        let symbol: String
        switch module {
        case .lights: symbol = "lightbulb.fill"
        case .climate: symbol = "thermometer.medium"
        case .fan: symbol = "fan.fill"
        case .wifi: symbol = "wifi"
        case .sonos: symbol = "speaker.wave.2.fill"
        case .weather: symbol = "cloud.sun.fill"
        case .photos: symbol = "photo.fill"
        case .walk: symbol = "figure.walk"
        case .reminders: symbol = "checklist"
        case .alarms: symbol = "alarm.fill"
        case .calendar: symbol = "calendar"
        case .media: symbol = "play.rectangle.fill"
        case .tesla: symbol = "car.fill"
        case .cameras: symbol = "video.fill"
        default: symbol = "app.fill"
        }
        return NotificationSource(name: module?.title ?? id.capitalized, symbol: symbol)
    }
}

/// Also used inside Home's full-screen destinations; isolated previews/tests need no service.
struct PanelNotificationOverlay: View {
    @Environment(NotificationCenter.self) private var center: NotificationCenter?
    var body: some View {
        if center != nil { NotificationBanners(source: PanelNotifications.source) }
    }
}
