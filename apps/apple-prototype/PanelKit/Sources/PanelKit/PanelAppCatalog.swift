import Foundation

/// Stable feature routes are shared by the live host and the Mac design host.
/// Adding a feature makes the destination resolver's switch exhaustive at compile time.
public enum PanelAppFeature: String, Sendable, CaseIterable {
    case lights, climate, music, weather, calendar, walks, cameras, photos, car, wifi
}
public enum PanelAppRoute: Sendable, Equatable {
    case feature(PanelAppFeature)
    case settings
    case timer
    case photoBooth
    case clock
    case classic
}
public struct PanelAppDefinition: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let symbol: String
    public let accent: String
    public let route: PanelAppRoute
    public init(id: String, name: String, symbol: String, accent: String, route: PanelAppRoute) {
        self.id = id; self.name = name; self.symbol = symbol; self.accent = accent; self.route = route
    }
}

/// Display order, identity and routing have one source of truth. This catalog
/// contains no provider instances, mutable view state, networking or credentials.
public struct PanelAppCatalog: Sendable {
    public let apps: [PanelAppDefinition]
    public enum ValidationError: Error, Equatable { case duplicateID(String), emptyMetadata }
    public init(apps: [PanelAppDefinition]) throws {
        var ids = Set<String>()
        for app in apps {
            guard !app.id.isEmpty, !app.name.isEmpty, !app.symbol.isEmpty else { throw ValidationError.emptyMetadata }
            guard ids.insert(app.id).inserted else { throw ValidationError.duplicateID(app.id) }
        }
        self.apps = apps
    }
    public func app(id: String) -> PanelAppDefinition? { apps.first { $0.id == id } }
    public func visibleApps(classicSupported: Bool) -> [PanelAppDefinition] {
        apps.filter { classicSupported || $0.route != .classic }
    }
    public static let standard: PanelAppCatalog = {
        // Authored, validated identifiers; these are not database record IDs.
        let definitions: [PanelAppDefinition] = [
            .init(id: "calendar", name: "Calendar", symbol: "calendar", accent: "#e54b4b", route: .feature(.calendar)),
            .init(id: "weather", name: "Weather", symbol: "cloud.sun.fill", accent: "#3389e9", route: .feature(.weather)),
            .init(id: "lights", name: "Lights", symbol: "lightbulb.fill", accent: "#f6a623", route: .feature(.lights)),
            .init(id: "climate", name: "Climate", symbol: "thermometer.medium", accent: "#10a9e8", route: .feature(.climate)),
            .init(id: "walks", name: "Dog Walker", symbol: "pawprint.fill", accent: "#31b870", route: .feature(.walks)),
            .init(id: "photos", name: "Photos", symbol: "photo.on.rectangle.angled", accent: "#a563dc", route: .feature(.photos)),
            .init(id: "car", name: "Tesla", symbol: "car.side.fill", accent: "#387eab", route: .feature(.car)),
            .init(id: "wifi", name: "Wi-Fi", symbol: "wifi", accent: "#37aebd", route: .feature(.wifi)),
            .init(id: "music", name: "Music", symbol: "music.note", accent: "#f34368", route: .feature(.music)),
            .init(id: "cameras", name: "Cameras", symbol: "video.fill", accent: "#626f88", route: .feature(.cameras)),
            .init(id: "clock", name: "Clock", symbol: "clock.fill", accent: "#3f945d", route: .clock),
            .init(id: "timer", name: "Timer", symbol: "timer", accent: "#ed951c", route: .timer),
            .init(id: "booth", name: "Photo Booth", symbol: "camera.fill", accent: "#cc476b", route: .photoBooth),
            .init(id: "classic", name: "Classic", symbol: "safari", accent: "#4b67c9", route: .classic),
            .init(id: "settings", name: "Settings", symbol: "gearshape.fill", accent: "#707986", route: .settings)
        ]
        do { return try PanelAppCatalog(apps: definitions) }
        catch { preconditionFailure("Invalid built-in app catalog: \(error)") }
    }()
}

public struct PanelShellState: Sendable, Equatable {
    public enum Screen: Sendable, Equatable { case clock, launcher, app(String) }
    public private(set) var screen: Screen = .clock
    public init() {}
    public mutating func showLauncher() { screen = .launcher }
    public mutating func showClock() { screen = .clock }
    @discardableResult public mutating func open(_ id: String, catalog: PanelAppCatalog = .standard) -> Bool {
        guard let app = catalog.app(id: id) else { return false }
        screen = app.route == .clock ? .clock : .app(id)
        return true
    }
}
