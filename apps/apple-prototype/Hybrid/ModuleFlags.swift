import Foundation

enum PanelModule: String, CaseIterable, Codable, Sendable {
    case all, lights, climate, fan, wifi, sonos, weather, walk, reminders, alarms, tesla
}

enum ModuleFlag: String, Codable, Sendable {
    case native, web
}

struct ModuleFlags: Equatable, Sendable {
    /// Live and verified on the wall (WWW-48): these default to native in shipped builds.
    /// Every other module, and any module whose live data is missing, keeps the web board.
    static let shippedNative: Set<PanelModule> = [.lights, .climate, .fan, .wifi, .sonos, .weather, .walk]
    /// iOS Settings > Panel > "Web board only": one switch that sends every module back to web.
    static let webOnlyKey = "hybrid.webOnly"

    private let values: [PanelModule: ModuleFlag]

    /// `native`/`web` win; missing or `default` takes the default; anything else fails to web.
    init(overrides: [String: String] = [:], nativeByDefault: Set<PanelModule> = [], webOnly: Bool = false) {
        values = Dictionary(uniqueKeysWithValues: PanelModule.allCases.map { module in
            let fallback: ModuleFlag = module != .all && nativeByDefault.contains(module) ? .native : .web
            let raw = overrides["moduleFlag.\(module.rawValue)"] ?? "default"
            let flag = webOnly ? .web : raw == "default" ? fallback : ModuleFlag(rawValue: raw) ?? .web
            return (module, flag)
        })
    }

    init(defaults: UserDefaults, nativeByDefault: Set<PanelModule> = []) {
        // UserDefaults includes NSArgumentDomain: -moduleFlag.lights native.
        self.init(overrides: Dictionary(uniqueKeysWithValues: PanelModule.allCases.compactMap { module in
            let key = "moduleFlag.\(module.rawValue)"
            return defaults.string(forKey: key).map { (key, $0) }
        }), nativeByDefault: nativeByDefault, webOnly: defaults.bool(forKey: Self.webOnlyKey))
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
