import AirMilesCore
import SwiftUI
import UniformTypeIdentifiers

@main struct AirMilesApp: App {
    @State private var store = FlightStore()
    var body: some Scene {
        WindowGroup {
            RootView().environment(store).tint(.primary)
                .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("--dark") ? .dark : ProcessInfo.processInfo.arguments.contains("--light") ? .light : nil)
        }
    }
}

enum AMStyle {
    static let ink = Color(light: AMPlatformColor(white: 0.055, alpha: 1), dark: .black)
    static let paper = Color(light: AMPlatformColor(white: 0.96, alpha: 1), dark: .black)
    // OLED black surfaces; hierarchy comes from spacing and fine borders.
    static let card = Color(light: .white, dark: .black)
    static let map = Color(light: AMPlatformColor(white: 0.08, alpha: 1), dark: .black)
    static let line = Color.primary.opacity(0.09)
}

extension View {
    func panel() -> some View {
        background(AMStyle.card, in: RoundedRectangle(cornerRadius: 22))
            .overlay { RoundedRectangle(cornerRadius: 22).strokeBorder(AMStyle.line, lineWidth: 0.5) }
    }
}

struct Eyebrow: View {
    var title: String
    init(_ title: String) { self.title = title }
    var body: some View { Text(title).font(.caption.weight(.medium)).foregroundStyle(.secondary) }
}

struct RootView: View {
    @Environment(FlightStore.self) private var store
    @State private var tab = 0
    @State private var importing = false
    @State private var pendingImport = false
    @State private var showImportInfo = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme
    @State private var globeInteraction = GlobeInteraction()
    @State private var globePlacement: GlobePlacement?
    @State private var globeSlots: [String: GlobePlacement] = [:]
    @State private var globeTravelling = false
    @State private var globeTravelGeneration = 0
    @State private var waitingForGlobeSlot = false
    @State private var travelViewport: CGRect = .zero
    @State private var sidebarOccludesGlobe = false
    var body: some View {
        @Bindable var store = store
        TabView(selection: $tab) {
            NavigationStack {
                OverviewView { tab = 1 }
                    .toolbar { importToolbar }
            }.tabItem { Label("Overview", systemImage: "globe.americas") }.tag(0)
            FlightJournalView().tabItem { Label("Flights", systemImage: "airplane") }.tag(1)
            NavigationStack {
                PassportView().toolbar { importToolbar }
            }.tabItem { Label("Passport", systemImage: "chart.bar.xaxis") }.tag(2)
        }
        .environment(globeInteraction)
        .environment(\.globeIsTravelling, globeTravelling || waitingForGlobeSlot)
        .overlay(alignment: .topLeading) {
            GeometryReader { proxy in
                let origin = proxy.frame(in: .global).origin
                if let globalPlacement = globePlacement {
                    let placement = GlobePlacement(id: globalPlacement.id,
                        rect: globalPlacement.rect.offsetBy(dx: -origin.x, dy: -origin.y),
                        flights: globalPlacement.flights, emphasized: globalPlacement.emphasized,
                        clipRect: globalPlacement.clipRect?.offsetBy(dx: -origin.x, dy: -origin.y))
                    ZStack(alignment: .topLeading) {
                        if colorScheme == .dark {
                            // The sky stays in root coordinates while only its aperture moves.
                            StarField().mask {
                                Rectangle().padding(12).blur(radius: 14)
                                    .frame(width: placement.rect.width, height: placement.rect.height)
                                    .position(x: placement.rect.midX, y: placement.rect.midY)
                            }
                            .clipShape(GlobeClipShape(rect: globeTravelling ? CGRect(origin: .zero, size: proxy.size) : placement.visibleRect.offsetBy(dx: placement.rect.minX, dy: placement.rect.minY)))
                            .allowsHitTesting(false).accessibilityHidden(true)
                        }
                        RouteAtlas(flights: placement.flights, airports: store.airports,
                           emphasized: placement.emphasized, spinning: globeInteraction.spinning && globeIsVisible && !placement.visibleRect.isEmpty,
                           interaction: globeInteraction, showsStars: false)
                    .overlay(alignment: .bottomTrailing) {
                        GlobeControls(interaction: globeInteraction, allowsRotation: placement.emphasized == nil)
                            .opacity(globeTravelling || waitingForGlobeSlot ? 0 : 1)
                    }
                    .frame(width: max(1, placement.rect.width), height: max(1, placement.rect.height))
                    .clipShape(GlobeClipShape(rect: globeTravelling ? CGRect(origin: .zero, size: placement.rect.size) : placement.visibleRect))
                    .contentShape(GlobeClipShape(rect: placement.visibleRect))
                    .position(x: placement.rect.midX, y: placement.rect.midY)
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                    .contentShape(GlobeClipShape(rect: placement.visibleRect.offsetBy(dx: placement.rect.minX, dy: placement.rect.minY)))
                    .mask {
                        // Native bars can move to either side on Duo. Use measured
                        // content viewports instead of assuming top/bottom bars.
                        GlobeClipShape(rect: globeTravelling ? travelViewport.offsetBy(dx: -origin.x, dy: -origin.y) : CGRect(origin: .zero, size: proxy.size))
                    }
                    .opacity(globeIsVisible ? 1 : 0)
                    .allowsHitTesting(globeIsVisible && !globeTravelling && !waitingForGlobeSlot)
                    .accessibilityHidden(!globeIsVisible)
                }
            }
        }
        .onPreferenceChange(GlobePlacementKey.self) { slots in
            globeSlots = slots
            if slots[tab == 0 ? "overview" : "journal"] == nil { waitingForGlobeSlot = false }
            moveGlobe()
        }
        .onPreferenceChange(GlobeOcclusionKey.self) { occluded in
            sidebarOccludesGlobe = occluded
            if occluded && tab == 1 { globeTravelling = false; waitingForGlobeSlot = false }
        }
        .onChange(of: tab) { _, _ in
            waitingForGlobeSlot = tab != 2 && horizontalSizeClass == .regular && globePlacement != nil && !reduceMotion
            moveGlobe()
        }
        .onChange(of: horizontalSizeClass) { _, value in
            if value == .compact { waitingForGlobeSlot = false }
            moveGlobe()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            if case .failure(let error) = result, (error as NSError).code == NSUserCancelledError { return }
            do { try store.importCSV(from: result.get()) }
            catch { store.error = error.localizedDescription }
        }
        .sheet(isPresented: $showImportInfo, onDismiss: {
            if pendingImport { pendingImport = false; importing = true }
        }) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "tray.and.arrow.down").font(.system(size: 36, weight: .light))
                    Text("Bring your flights.").font(.largeTitle.bold())
                    Text("Import your flight-history CSV. Everything stays on this device.").foregroundStyle(.secondary)
                    Text("Columns: date, airline, flight, from, to, miles, confidence.").font(.callout.monospaced())
                    Text("A new import replaces the current journal after validation. Original dates, distances and uncertainty are preserved.").font(.footnote).foregroundStyle(.secondary)
                    Button("Choose CSV") { pendingImport = true; showImportInfo = false }
                        .buttonStyle(.plain).font(.headline)
                        .foregroundStyle(AMStyle.paper)
                        .padding(.horizontal, 24).padding(.vertical, 14)
                        .background(Color.primary, in: Capsule())
                        .accessibilityIdentifier("chooseCSV")
                    Spacer()
                    Text("Map: Natural Earth · Airports: OurAirports\nPublic domain. Distances are imported great-circle estimates.").font(.caption).foregroundStyle(.secondary)
                }.padding(28).navigationTitle("Your data").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showImportInfo = false } } }
            }.presentationDetents([.large])
        }
        .alert("Couldn’t load flights", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
    private var globeIsVisible: Bool {
        tab != 2 && !(tab == 1 && sidebarOccludesGlobe) && (globeTravelling || waitingForGlobeSlot || globeSlots[tab == 0 ? "overview" : "journal"] != nil)
            && globePlacement?.visibleRect.isEmpty == false
    }

    private func moveGlobe() {
        let key = tab == 0 ? "overview" : "journal"
        guard tab != 2, let destination = globeSlots[key], destination.rect.width > 0 else { return }
        let changingView = globePlacement?.id != destination.id || globePlacement?.emphasized?.id != destination.emphasized?.id
        waitingForGlobeSlot = false
        guard globePlacement != destination else { return }
        guard changingView || globeTravelling, !reduceMotion, let source = globePlacement,
              !source.visibleRect.isEmpty, !destination.visibleRect.isEmpty else {
            globePlacement = destination
            return
        }
        // Native split views publish provisional geometry before settling. Retarget
        // a move as those measurements arrive instead of snapping at completion.
        let viewport = (source.clipRect ?? source.rect).union(destination.clipRect ?? destination.rect)
        travelViewport = globeTravelling ? travelViewport.union(viewport) : viewport
        globeTravelling = true
        globeTravelGeneration += 1
        let generation = globeTravelGeneration
        var transaction = Transaction(animation: .easeInOut(duration: 0.48))
        transaction.disablesAnimations = false
        transaction.addAnimationCompletion(criteria: .logicallyComplete) {
            guard globeTravelGeneration == generation else { return }
            globeTravelling = false
            moveGlobe()
        }
        withTransaction(transaction) { globePlacement = destination }
    }

    @ToolbarContentBuilder private var importToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Image(systemName: "airplane")
                .font(.system(size: 21, weight: .medium))
                .frame(width: 44, height: 44, alignment: .center)
                .accessibilityLabel("Air Miles")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { showImportInfo = true } label: { Label("Import flight history", systemImage: "tray.and.arrow.down") }
        }
    }
}
