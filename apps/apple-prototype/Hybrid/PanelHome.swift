import SwiftUI
import PanelKit

extension HomeTile {
    static var panelProviders: Set<PanelModule> { Set(allCases.filter { $0 != .cameras }.map(\.panelModule)) }
    var panelModule: PanelModule {
        switch self {
        case .climate: .climate
        case .fan: .fan
        case .wifi: .wifi
        case .clock, .alarm: .alarms
        case .weather, .hourly: .weather
        case .sound, .sonosRooms: .sonos
        case .tesla: .tesla
        case .calendar: .calendar
        case .media: .media
        case .cameras: .cameras
        case .photos: .photos
        case .dogwalk: .walk
        case .bedroom, .livingRoom, .ceiling, .cabinet, .all, .lamps, .lights: .lights
        }
    }
}

struct PanelHome: View {
    @Environment(\.motionPhase) private var inheritedMotionPhase
    @State private var presentation: PanelHomePresentation
    let timer: PanelTimerStore

    init(store: LiveHomeDataSource, session: PanelSession,
         navigation: PanelNavigation, timer: PanelTimerStore) {
        self.timer = timer
        _presentation = State(initialValue: PanelHomePresentation(store: store, session: session,
            navigation: navigation))
    }

    var body: some View {
        HomeView(store: presentation.store, initialFace: presentation.navigation.homeStartsInLauncher ? HomeFacePage.home : HomeFacePage.clock, managedTimer: timer, onWake: presentation.captureWake)
            .environment(\.homeIntegration, presentation)
            .environment(\.motionPhase, Self.fixtureMotionPhase ?? inheritedMotionPhase)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("native-home")
            .overlay(alignment: .topLeading) {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-hybridControlWrites") {
                    Text(HybridControlWriteTrace.shared.value).font(.caption2)
                        .foregroundStyle(ProcessInfo.processInfo.arguments.contains("-hideFixtureTrace") ? Color.clear : Color.primary)
                        .accessibilityIdentifier("fixture-control-write").allowsHitTesting(false)
                }
                #endif
            }

    }
    // The snapshot seam pauses decorative loops in fixture runs so XCTest can
    // become idle and the shared simulator does not render them continuously.
    private static var fixtureMotionPhase: Double? {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-hybridFixtures")
            && !ProcessInfo.processInfo.arguments.contains("-hybridMotion") ? 0 : nil
        #else
        nil
        #endif
    }

}

@MainActor final class PanelHomePresentation: HomeIntegration {
    let store: LiveHomeDataSource
    let session: PanelSession
    let navigation: PanelNavigation
    let caption = ""
    var panelPIN: PanelPINAPI? { store.panelPIN }
    func photoBooth(close: @escaping () -> Void) -> AnyView? {
        AnyView(LivePhotoBoothModule(camera: store.photoBoothCamera, photos: store.photosProvider, close: close))
    }
    private let wakeCapture = PanelWakeCapture()
    func captureWake() {
        #if DEBUG
        guard !ProcessInfo.processInfo.arguments.contains("-hybridFixtures") else { return }
        #endif
        wakeCapture.capture(using: store.diagnosticsClient)
    }

    init(store: LiveHomeDataSource, session: PanelSession,
         navigation: PanelNavigation) {
        self.store = store
        self.session = session
        self.navigation = navigation
    }

    func prepareToOpen(_ tile: HomeTile) -> Bool {
        guard !Self.isInformationalFace(tile), tile != .fan else { return false }
        return true
    }

    static func isInformationalFace(_ tile: HomeTile) -> Bool {
        [.clock].contains(tile)
    }

    func available(_ tile: HomeTile) -> Bool {
        guard let module = HomeModule(rawValue: tile.panelModule.rawValue) else { return true }
        return store.status(for: module) == .live
    }

    func tile(_ tile: HomeTile, open: @escaping () -> Void) -> AnyView? {
        if Self.isInformationalFace(tile) {
            if tile != .clock, let module = HomeModule(rawValue: tile.panelModule.rawValue),
               store.status(for: module) != .live {
                return AnyView(ModuleStatusFace(title: tile.title, status: store.status(for: module))
                    .frame(maxWidth: .infinity, maxHeight: .infinity))
            }
            return AnyView(TileFace(tile: tile, store: store, open: {}).allowsHitTesting(false))
        }
        if tile != .clock, let module = HomeModule(rawValue: tile.panelModule.rawValue),
           store.status(for: module) != .live {
            return AnyView(Button(action: open) {
                ModuleStatusFace(title: tile == .fan ? "Fan" : tile.title,
                    status: store.status(for: module))
                    .frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(.rect)
            }.buttonStyle(.plain).accessibilityIdentifier("tile-unavailable-\(tile.id)"))
        }
        switch tile {
        case .sound: return AnyView(PanelSoundTile(store: store, open: open))
        case .fan:
            return AnyView(AccessoryFace(key: .fan, store: store, open: open,
                fanIsOn: store.fanProvider.fanOn))
        case .dogwalk:
            return AnyView(DogWalkTile(store: HybridWalkDataSource(store: store), open: open)
                .disabled(store.walkProvider.isMutating))
        case .cameras:
            return AnyView(PanelTileLauncher(label: "Open Cameras", open: open) {
                CamerasModule(provider: self.store.camerasProvider, detail: false, open: open)
            })
        case .photos:
            return AnyView(Button(action: open) {
                Label("Photos", systemImage: "lock.fill").font(.title2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }.buttonStyle(.plain))
        default: return nil
        }
    }

    func gridTile(_ tile: HomeTile, span: CGSize, open: @escaping () -> Void) -> AnyView? {
        if tile == .clock {
            return AnyView(GridClock(v: "H", store: store).allowsHitTesting(false))
        }
        return AnyView(PanelAccessoryCard(tile: tile, store: store, open: open))
    }

    func artwork(_ room: SoundRoom) -> AnyView? {
        AnyView(SonosArtwork(room: room, api: store.sonosArtwork))
    }

    func musicFace(close: @escaping () -> Void) -> AnyView {
        AnyView(SonosModule(store: store, close: close, isFace: true))
    }

    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView {
        AnyView(PanelHomeDestination(module: tile.panelModule, store: store, session: session,
            close: close)
            .overlay { PanelStatusOverlays(store: store, session: session, navigation: navigation) }
            .modifier(NotificationHistoryAccess()))
    }
}

/// Keep production adapters (alarm persistence, photo access, authenticated
/// artwork, server-time walks) at the host boundary, outside the design views.
struct PanelHomeDestination: View {
    let module: PanelModule
    let store: LiveHomeDataSource
    let session: PanelSession
    let close: () -> Void

    private var ready: Bool {
        store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
    }

    private var awaitingWifi: Bool {
        module == .wifi && store.wifiProvider.availability == .loading
    }

    var body: some View {
        Group {
            if ready || awaitingWifi || module == .calendar {
                HybridNativeModule(module: module, store: store, detail: true, open: {}, close: close)
                    .opacity(awaitingWifi ? 0 : 1).allowsHitTesting(!awaitingWifi)
                    .overlay { if awaitingWifi { ProgressView("Refreshing Wi-Fi") } }
            } else {
                ModuleStatusFace(title: module.title,
                    status: store.status(for: HomeModule(rawValue: module.rawValue) ?? .lights)).padding(48)
            }
        }
        // The shell clips the complete app surface. Keep this host unclipped so
        // module backgrounds can extend beneath the shell's Back safe area.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black).preferredColorScheme(.dark).foregroundStyle(.white)
        .statusBarHidden().persistentSystemOverlays(.hidden)
    }
}

struct PanelHomeButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.left")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 48, height: 48).contentShape(.circle)
        }.buttonStyle(.glass).buttonBorderShape(.circle)
            .accessibilityLabel("Back").accessibilityIdentifier("module-home")
    }
}

private struct PanelSoundTile: View {
    let store: LiveHomeDataSource
    let open: () -> Void
    var inset: CGFloat = 32
    var body: some View {
        Button(action: open) {
            if store.status(for: .sonos) != .live {
                ModuleStatusFace(title: "Now Playing", status: store.status(for: .sonos)).padding(inset)
            } else {
                HStack(spacing: 24) {
                    if let room = store.rooms.first {
                        SonosArtwork(room: room, api: store.sonosArtwork)
                            .frame(width: 112, height: 112).clipped()
                        VStack(alignment: .leading, spacing: 8) {
                            Text(room.trackTitle ?? "Nothing playing").font(.title2.weight(.semibold))
                            Text(room.trackArtist ?? "Sonos").font(.body)
                            Text(room.name).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }.padding(inset).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.buttonStyle(.plain)
    }
}

/// A single visual vocabulary for the live panel: accessory glyph, name, state.
/// Detail controls stay in their native destinations; quick actions stay explicit.
private struct PanelCardGlyph: View {
    let symbol: String
    var color: Color = .white
    var body: some View {
        Image(systemName: symbol).font(.system(size: 28, weight: .medium))
            .symbolRenderingMode(.hierarchical).foregroundStyle(color)
            .frame(width: 48, height: 48, alignment: .leading)
            .accessibilityHidden(true)
    }
}

private struct PanelCardSummary: View {
    let symbol: String
    var color: Color = .white
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelCardGlyph(symbol: symbol, color: color)
            Spacer(minLength: 12)
            Text(title).font(.system(size: 22, weight: .semibold)).lineLimit(1)
            Text(subtitle).font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
                .lineLimit(1).padding(.top, 4)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).padding(28)
    }
}

private struct PanelAccessoryCard: View {
    @AppStorage("panel.weatherDesign") private var weatherDesign = 0
    let tile: HomeTile
    let store: LiveHomeDataSource
    let open: () -> Void
    var body: some View {
        Group {
            if [.weather, .hourly, .tesla, .calendar, .sonosRooms, .wifi, .media, .photos, .cameras].contains(tile) {
                Button(action: open) { content.frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(.rect) }
                    .buttonStyle(.plain)
            } else {
                content.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .modifier(GridCardInteraction(label: "Open \(tile.title)", open: open, enabled: tile != .fan))
            }
        }
    }
    @ViewBuilder private var content: some View {
        switch tile {
        case .climate: climate
        case .lamps: lamps
        case .ceiling, .lights, .cabinet, .all: lights
        case .fan: fan
        case .weather, .hourly: WeatherDesignCard(weather: store.weather, style: weatherDesign)
        case .tesla: car
        case .calendar: calendar
        case .sound: sound
        case .sonosRooms:
            PanelCardSummary(symbol: "hifispeaker.2.fill", color: .orange, title: "Sonos rooms",
                subtitle: "\(store.rooms.count { $0.playing }) playing · \(store.rooms.count) rooms")
        case .wifi:
            PanelCardSummary(symbol: "wifi", color: .blue, title: "Wi-Fi",
                subtitle: store.wifi.ssid ?? "Guest network unavailable")
        case .media:
            PanelCardSummary(symbol: "play.rectangle.fill", color: .pink, title: "Media",
                subtitle: store.media.items.isEmpty ? "Library empty" : "\(store.media.items.count) items in your library")
        case .photos:
            VStack(alignment: .leading, spacing: 0) {
                HStack { PanelCardGlyph(symbol: "photo.stack", color: .pink); Spacer(); Image(systemName: "lock.fill").foregroundStyle(.white.opacity(0.65)) }
                Spacer()
                title("Photos", subtitle: "Unlock to view your library")
            }.padding(28)
        case .cameras: PanelCameraCard(provider: store.camerasProvider)
        case .dogwalk: walk
        default: EmptyView()
        }
    }
    private func title(_ name: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(name).font(.system(size: 22, weight: .semibold)).lineLimit(2)
            Text(subtitle).font(.system(size: 17)).foregroundStyle(.white.opacity(0.65)).lineLimit(2)
        }
    }
    private var climate: some View {
        let c = store.climate
        let temperature = c.mode == .off ? "Off" : c.mode == .heatCool ? "\(c.low)–\(c.high)°" : "\(c.target)°"
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                PanelCardGlyph(symbol: c.mode == .heat ? "sun.max.fill" : "snowflake", color: c.mode == .heat ? .orange : .cyan)
                Spacer()
                Text(c.action).font(.system(size: 17, weight: .medium)).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Text(temperature).font(.system(size: 88, weight: .regular, design: .rounded)).monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
            title("Climate", subtitle: "Set temperature · Inside \(c.ambient)°")
        }.padding(28).background { LinearGradient(colors: [.cyan.opacity(0.28), .blue.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing).allowsHitTesting(false) }
    }
    private var lamps: some View {
        HStack(spacing: 20) {
            Button { store.send(.toggle(.lamps)) } label: {
                Image(systemName: "lamp.table.fill").font(.system(size: 30))
                    .foregroundStyle(store.lamps.anyOn ? .yellow : .secondary)
                    .frame(width: 64, height: 64).background(.white.opacity(0.08), in: .circle)
            }.buttonStyle(.plain).accessibilityLabel("Toggle lamps")
            title("Lamps", subtitle: store.lamps.anyOn ? "\(store.lamps.onCount()) on · \(store.lamps.brightness)%" : "Off")
            Spacer(minLength: 0)
        }.padding(28)
    }
    private var lights: some View {
        let accessory: Accessory = tile == .cabinet ? .cabinet : .ceiling
        let on = store.lamps.isOn(accessory)
        return HStack(spacing: 22) {
            Button { store.send(.toggle(accessory)) } label: {
                Image(systemName: accessory.symbol).font(.system(size: 36))
                    .foregroundStyle(on ? .yellow : .white.opacity(0.5))
                    .frame(width: 72, height: 72)
                    .background(.white.opacity(0.08), in: .circle)
            }.buttonStyle(.plain).accessibilityLabel("Toggle \(accessory.name)")
            Text(accessory == .cabinet ? "Cabinet" : "Ceiling").font(.system(size: 22, weight: .semibold)).accessibilityValue(on ? "On" : "Off")
            Spacer(minLength: 0)
        }.padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

    }
    private var fan: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                PanelCardGlyph(symbol: "fan.fill", color: store.fanProvider.fanOn == true ? .cyan : .white)
                title("Fan", subtitle: store.fanProvider.fanLabel ?? "Unavailable")
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            Picker("Fan mode", selection: Binding(get: { store.climate.selectedFanMode ?? "auto" }, set: { store.send(.fanMode($0)) })) {
                ForEach(store.climate.fanModes, id: \.self) { Text($0.capitalized).tag($0) }
            }.pickerStyle(.segmented).labelsHidden()
        }.padding(28)
    }
    private var weather: some View {
        let w = store.weather
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                PanelCardGlyph(symbol: w.symbol, color: .cyan)
                Spacer()
                Text(w.city).font(.system(size: 18, weight: .medium)).foregroundStyle(.white.opacity(0.65))
            }
            Spacer(minLength: 12)
            Text("\(w.temperature)°").font(.system(size: 80, weight: .regular, design: .rounded))
            title(w.condition, subtitle: "H:\(w.high)°  L:\(w.low)°")
            Spacer(minLength: 20)
            HStack {
                ForEach(w.hours.prefix(5)) { hour in
                    VStack(spacing: 10) {
                        Text(hour.time).font(.system(size: 14)).foregroundStyle(.white.opacity(0.65))
                        Image(systemName: hour.symbol).symbolRenderingMode(.multicolor).font(.system(size: 19)).frame(height: 24)
                        Text("\(hour.temperature)°").font(.system(size: 18, weight: .medium))
                    }.frame(maxWidth: .infinity)
                }
            }
        }.padding(28).background(LinearGradient(colors: [.blue.opacity(0.45), .indigo.opacity(0.15)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }
    private var car: some View {
        TeslaTile(provider: store.tesla)
    }
    private var calendar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                PanelCardGlyph(symbol: "calendar", color: .red)
                Spacer()
                Text(store.calendar.dateText(at: store.now, format: "EEE, d MMM"))
                    .font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
            }
            Text("Up next").font(.system(size: 22, weight: .semibold)).padding(.top, 8)
            Spacer(minLength: 20)
            if store.calendar.events.isEmpty {
                title("Your day is clear", subtitle: "No upcoming events")
            } else {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(store.calendar.events.prefix(3)) { event in
                        HStack(spacing: 14) {
                            Capsule().fill(.red.opacity(0.8)).frame(width: 4)
                            title(event.title, subtitle: "\(event.time) \(event.period)" + (event.location.isEmpty ? "" : " · \(event.location)"))
                        }.fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }.padding(28)
    }
    private var sound: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                PanelCardGlyph(symbol: "music.note", color: .pink)
                Spacer()
                if let room = store.rooms.first {
                    SonosArtwork(room: room, api: store.sonosArtwork, compact: true)
                        .frame(width: 96, height: 96).clipShape(.rect(cornerRadius: 18))
                }
            }
            Spacer()
            if let room = store.rooms.first {
                title(room.trackTitle ?? "Nothing playing", subtitle: room.trackArtist ?? room.sourceLabel ?? "Sonos")
                HStack {
                    Text(room.name).font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
                    Spacer()
                    Button { store.send(.transport(room.id, room.playing ? .pause : .play)) } label: {
                        Image(systemName: room.playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 24)).frame(width: 56, height: 56)
                            .background(.white.opacity(0.1), in: .circle)
                    }.buttonStyle(.plain).accessibilityLabel(room.playing ? "Pause" : "Play")
                }.padding(.top, 20)
            } else { title("Now Playing", subtitle: "Nothing playing") }
        }.padding(28)
    }
    private var walk: some View {
        TimelineView(.periodic(from: store.now, by: 1)) { _ in
            let data = HybridWalkDataSource(store: store)
            VStack(alignment: .leading, spacing: 0) {
                PanelCardGlyph(symbol: "pawprint.fill", color: .green)
                Spacer()
                if let active = data.walks.activeWalk {
                    Text(walkElapsed(active.duration(at: data.now)))
                        .font(.system(size: 64, weight: .regular, design: .rounded)).monospacedDigit()
                    title("Walking Zero", subtitle: "Started on \(active.startedBy.rawValue)")
                } else {
                    title("Dog Walker", subtitle: data.walks.lastWalkLabel(at: data.now))
                }
                HStack {
                    Text("\(data.walks.summary(at: data.now).weeklyMinutes) min this week")
                        .font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
                    Spacer()
                    Button { data.toggleWalk() } label: {
                        Image(systemName: data.activeWalk == nil ? "play.fill" : "stop.fill")
                            .font(.system(size: 22)).foregroundStyle(.green)
                            .frame(width: 56, height: 56).background(.green.opacity(0.12), in: .circle)
                    }.buttonStyle(.plain).disabled(store.walkProvider.isMutating)
                        .accessibilityLabel(data.activeWalk == nil ? "Start walking Zero" : "Stop walking Zero")
                }.padding(.top, 24)
            }.padding(28)
        }
    }
}

private struct PanelCameraCard: View {
    let provider: LiveCamerasProvider
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                PanelCardGlyph(symbol: "video.fill", color: .mint)
                Spacer()
                Text("\(provider.feeds.count) cameras").font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
            }
            if let feed = provider.feeds.first {
                GeometryReader { proxy in
                    if let image = provider.frames[feed.id] {
                        Image(decorative: image, scale: 1).resizable().scaledToFill()
                            .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                    } else {
                        Image(systemName: "video.slash").font(.largeTitle).foregroundStyle(.white.opacity(0.65))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }.clipShape(.rect(cornerRadius: 18))
                VStack(alignment: .leading, spacing: 5) {
                    Text(feed.name).font(.system(size: 22, weight: .semibold))
                    Text(provider.frames[feed.id] == nil ? "Snapshot unavailable" : "Camera snapshot")
                        .font(.system(size: 17)).foregroundStyle(.white.opacity(0.65))
                }
            } else { Spacer(); Text("No cameras").font(.title3) }
        }.padding(28)
            .task(id: "\(scenePhase)-\(provider.feeds.first?.id ?? "")") {
                guard scenePhase == .active, let feed = provider.feeds.first else { return }
                while !Task.isCancelled {
                    await provider.refreshSnapshots(ids: [feed.id])
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                }
            }
    }
}

struct PanelWeatherModule: View {
    let weather: WeatherState
    var body: some View { WeatherPage(weather: weather) }
}
