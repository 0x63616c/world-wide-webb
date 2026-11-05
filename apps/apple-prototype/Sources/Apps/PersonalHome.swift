import SwiftUI
import PanelKit

/// Navigation owns selection; the shared providers and timer outlive tab and
/// size-class changes. No idle-return policy runs on a personal device.
struct PersonalHome: View {
    let store: any HomeDataSource
    @Environment(\.scenePhase) private var scenePhase
    @State private var timer = PanelTimerStore()
    @Environment(PanelAppPreferences.self) private var preferences
    @State private var morePath: [String] = []
    @State private var selection = "home"
    @State private var desktopSelection: String? = "home"
    private let catalog = PanelAppCatalog.standard
    private let primaryIDs = ["lights", "climate", "spotify"]
    private var apps: [PanelAppDefinition] {
        catalog.apps.filter { $0.route != .classic && $0.route != .clock }
    }

    var body: some View {
        Group {
            #if os(macOS)
            NavigationSplitView {
                List(selection: $desktopSelection) {
                    NavigationLink(value: "home") { Label("Home", systemImage: "house") }
                    Section("Apps") {
                        ForEach(apps.filter { $0.route != .settings }) { app in
                            NavigationLink(value: app.id) { Label(app.name, systemImage: app.symbol) }
                        }
                    }
                }.navigationTitle("Control Center")
                    .navigationSplitViewColumnWidth(min: 180, ideal: 230, max: 300)
                    .toolbar { SettingsLink { Label("Settings", systemImage: "gearshape") } }
            } detail: {
                NavigationStack {
                    if let app = catalog.app(id: desktopSelection ?? "home") { destination(app) }
                    else { home }
                }
            }
            #else
            TabView(selection: $selection) {
                Tab("Home", systemImage: "house", value: "home") { NavigationStack { home } }
                ForEach(primaryIDs, id: \.self) { id in
                    if let app = catalog.app(id: id) {
                        Tab(app.name, systemImage: app.symbol, value: id) {
                            NavigationStack { destination(app) }
                        }
                    }
                }
                Tab("More", systemImage: "square.grid.2x2", value: "more") {
                    NavigationStack(path: $morePath) {
                        List(apps.filter { !primaryIDs.contains($0.id) }) { app in
                            NavigationLink(value: app.id) { Label(app.name, systemImage: app.symbol) }
                                .accessibilityIdentifier("personal-app-\(app.id)")
                        }.navigationTitle("More")
                            .navigationDestination(for: String.self) { id in
                                if let app = catalog.app(id: id) { destination(app) }
                            }
                    }
                }
            }.tabViewStyle(.sidebarAdaptable)
            #endif
        }
        .environment(preferences).environment(\.personalNavigation, true)
        .accessibilityIdentifier("personal-home")
        .onChange(of: store.walks.activeWalk, initial: true) { _, walk in
            store.walkActivity.synchronize(walk: walk, now: store.now)
        }
        .onOpenURL { url in
            if url.host == "dogwalk" { selection = "more"; morePath = ["walks"]; desktopSelection = "walks" }
        }
        #if os(iOS)
        .onChange(of: scenePhase == .active && (timer.keepsScreenAwake || store.walks.activeWalk != nil), initial: true) { _, awake in
            UIApplication.shared.isIdleTimerDisabled = awake
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        #endif
        .task(id: scenePhase) {
            guard scenePhase == .active else { timer.deactivate(); return }
            timer.activate()
            while !Task.isCancelled {
                timer.tick()
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }

    private var home: some View {
        List {
            Section("Quick controls") {
                ForEach([Accessory.bedroom, .livingRoom, .ceiling, .cabinet]) { accessory in
                    Toggle(isOn: Binding(get: { store.lamps.isOn(accessory) }, set: { _ in store.send(.toggle(accessory)) })) {
                        Label(accessory.name, systemImage: accessory.symbol)
                    }.disabled(store.status(for: .lights) != .live)
                }
            }
            Section("Climate") {
                if let app = catalog.app(id: "climate") {
                    NavigationLink { destination(app) } label: {
                        LabeledContent {
                            if store.status(for: .climate) == .live {
                                Text(climateSummary)
                            } else { Text("Unavailable") }
                        } label: { Label("Temperature", systemImage: "thermometer.medium") }
                    }
                }
            }
            Section("Apps") {
                ForEach(apps.filter { $0.id != "lights" && $0.id != "climate" }) { app in
                    #if os(macOS)
                    if app.route == .settings { SettingsLink { Label(app.name, systemImage: app.symbol) } }
                    else { NavigationLink { destination(app) } label: { Label(app.name, systemImage: app.symbol) } }
                    #else
                    NavigationLink { destination(app) } label: { Label(app.name, systemImage: app.symbol) }
                    #endif
                }
            }
        }.navigationTitle("Home")
    }

    private func destination(_ app: PanelAppDefinition) -> some View {
        PersonalAppDestination(app: app, store: store, timer: timer)
            .navigationTitle(app.name)
    }

    private var climateSummary: String {
        switch store.climate.mode {
        case .off: "Off"
        case .heatCool: "\(store.climate.low)–\(store.climate.high)°"
        default: "\(store.climate.target)°"
        }
    }
}

private struct PersonalAppDestination: View {
    let app: PanelAppDefinition
    let store: any HomeDataSource
    let timer: PanelTimerStore
    @Environment(\.dismiss) private var dismiss
    @Environment(PanelAppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var inheritedMotionPhase
    var body: some View {
        PanelAppContent(app: app, store: store, timer: timer, close: { dismiss() })
            .environment(\.motionPhase, preferences[app.id].reduceMotion ? 0 : inheritedMotionPhase)
            .transaction {
                if reduceMotion || preferences[app.id].reduceMotion { $0.animation = nil; $0.disablesAnimations = true }
            }
    }
}
