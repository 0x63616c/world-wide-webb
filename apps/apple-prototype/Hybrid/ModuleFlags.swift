import Foundation

enum PanelModule: String, CaseIterable, Codable, Sendable {
    case all, lights, climate, fan, wifi, sonos, weather, photos, walk, reminders
}

enum ModuleFlag: String, Codable, Sendable {
    case native, web
}

struct ModuleFlags: Equatable, Sendable {
    private let values: [PanelModule: ModuleFlag]

    init(overrides: [String: String] = [:]) {
        values = Dictionary(uniqueKeysWithValues: PanelModule.allCases.map {
            ($0, ModuleFlag(rawValue: overrides["moduleFlag.\($0.rawValue)"] ?? "") ?? .web)
        })
    }

    init(defaults: UserDefaults) {
        // UserDefaults includes NSArgumentDomain: -moduleFlag.lights native.
        self.init(overrides: Dictionary(uniqueKeysWithValues: PanelModule.allCases.compactMap { module in
            let key = "moduleFlag.\(module.rawValue)"
            return defaults.string(forKey: key).map { (key, $0) }
        }))
    }

    subscript(module: PanelModule) -> ModuleFlag { values[module] ?? .web }
}

/// A flag alone never enables fixture-backed native UI. The caller must also
/// have a native view with live data. `all` is the permanent whole-board escape.
struct HybridRouter: Sendable {
    enum Route: Equatable, Sendable {
        case native(PanelModule)
        case webBoard
    }

    let flags: ModuleFlags

    func route(for module: PanelModule, hasLiveData: Bool) -> Route {
        guard module != .all, flags[module] == .native, hasLiveData else { return .webBoard }
        return .native(module)
    }

    func usesWebBoardOnly(enabled: Set<PanelModule>, liveModules: Set<PanelModule>) -> Bool {
        enabled.allSatisfy { route(for: $0, hasLiveData: liveModules.contains($0)) == .webBoard }
    }
}
