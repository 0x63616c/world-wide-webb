import AirMilesCore
import RDesign
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
    static let ink = Color(light: RPlatformColor(white: 0.055, alpha: 1), dark: .black)
    static let paper = RPalette.background
    // OLED black surfaces; hierarchy comes from spacing and fine borders.
    static let card = Color(light: .white, dark: .black)
    static let map = Color(light: RPlatformColor(white: 0.08, alpha: 1), dark: .black)
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
    @State private var globeInteraction = GlobeInteraction()
    @State private var globePlacement: GlobePlacement?
    @State private var globeSlots: [String: GlobePlacement] = [:]
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
        .coordinateSpace(name: "globeRoot")
        .overlay(alignment: .topLeading) {
            if let placement = globePlacement {
                RouteAtlas(flights: placement.flights, airports: store.airports,
                           emphasized: placement.emphasized, spinning: globeInteraction.spinning && globeIsVisible && !placement.visibleRect.isEmpty,
                           interaction: globeInteraction)
                    .overlay(alignment: .bottomTrailing) { GlobeControls(interaction: globeInteraction, allowsRotation: placement.emphasized == nil) }
                    .frame(width: max(1, placement.rect.width), height: max(1, placement.rect.height))
                    .clipShape(GlobeClipShape(rect: placement.visibleRect))
                    .contentShape(GlobeClipShape(rect: placement.visibleRect))
                    .position(x: placement.rect.midX, y: placement.rect.midY)
                    .opacity(globeIsVisible ? 1 : 0)
                    .allowsHitTesting(globeIsVisible)
                    .accessibilityHidden(!globeIsVisible)
            }
        }
        .onPreferenceChange(GlobePlacementKey.self) { slots in
            globeSlots = slots
            moveGlobe()
        }
        .onChange(of: tab) { _, _ in moveGlobe() }
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
    private var globeIsVisible: Bool { tab != 2 && globeSlots[tab == 0 ? "overview" : "journal"] != nil && globePlacement?.visibleRect.isEmpty == false }

    private func moveGlobe() {
        let key = tab == 0 ? "overview" : "journal"
        guard tab != 2, let destination = globeSlots[key], destination.rect.width > 0 else { return }
        let changingView = globePlacement?.id != destination.id || globePlacement?.emphasized?.id != destination.emphasized?.id
        withAnimation(changingView && !reduceMotion && globePlacement != nil ? .easeInOut(duration: 0.5) : nil) {
            globePlacement = destination
        }
    }

    @ToolbarContentBuilder private var importToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Image(systemName: "airplane")
                .font(.system(size: 21, weight: .medium))
                .frame(width: 44, height: 44, alignment: .center)
                .accessibilityLabel("Air Miles")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { showImportInfo = true } label: { Image(systemName: "tray.and.arrow.down") }
                .accessibilityLabel("Import flight history")
        }
    }
}
