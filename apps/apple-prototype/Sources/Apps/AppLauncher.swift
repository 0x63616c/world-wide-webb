import SwiftUI
import PanelKit

struct AppLauncher: View {
    let apps: [PanelAppDefinition]
    let open: (PanelAppDefinition) -> Void
    let namespace: Namespace.ID
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        GeometryReader { proxy in
            let columns = sizeClass == .compact ? 3 : 5
            let iconSide: CGFloat = sizeClass == .compact ? 76 : 112
            ScrollView(.vertical) {
                VStack(spacing: 32) {
                    TimelineView(.periodic(from: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970 / 60) * 60), by: 60)) { context in
                        VStack(spacing: 6) {
                            Text(context.date, format: .dateTime.hour().minute())
                                .font(.system(size: 56, weight: .light, design: .rounded)).monospacedDigit()
                            Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                                .font(.title3.weight(.medium))
                        }.foregroundStyle(.white)
                    }.padding(.top, 36)
                GlassEffectContainer(spacing: 32) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 28), count: columns), spacing: 48) {
                        ForEach(apps) { app in
                            Button { open(app) } label: {
                                VStack(spacing: 14) {
                                    PanelAppIcon(app: app, side: iconSide)
                                        .matchedTransitionSource(id: app.id, in: namespace)
                                    Text(app.name).font(.system(size: sizeClass == .compact ? 15 : 21, weight: .medium))
                                        .foregroundStyle(.white).lineLimit(1)
                                }.frame(maxWidth: .infinity).contentShape(.rect)
                            }.buttonStyle(LauncherPressStyle()).accessibilityIdentifier("app-\(app.id)")
                        }
                    }.padding(.horizontal, sizeClass == .compact ? 20 : 72)
                        .padding(.vertical, 48)
                }
                }.frame(minHeight: proxy.size.height, alignment: .top)
            }.scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize)
        }.background { Wallpaper(dimming: 0.12, blurRadius: 0).accessibilityHidden(true) }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("app-launcher")
    }
}

/// Shared edge gesture: only the bottom centre 88 pt are reserved, leaving app scroll
/// views and controls alone. No visible navigation bar or page dots.
struct SwipeHomeRegion: View {
    let action: () -> Void
    var dragChanged: (CGFloat) -> Void = { _ in }
    var cancelled: () -> Void = {}
    var body: some View {
        Color.clear.frame(width: 220, height: 88).contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 12)
                .onChanged { dragChanged($0.translation.height) }
                .onEnded { value in
                    if value.translation.height < -60 || value.predictedEndTranslation.height < -150 { action() }
                    else { cancelled() }
                })
            .accessibilityElement().accessibilityLabel("Home")
            .accessibilityAddTraits(.isButton).accessibilityAction { action() }
    }
}

struct PanelSettingsPage: View {
    let back: () -> Void
    @Environment(\.homeIntegration) private var integration
    private enum Page: String, CaseIterable, Identifiable {
        case display = "Display", security = "Security", apps = "Apps"
        var id: String { rawValue }
        var symbol: String { self == .display ? "display" : (self == .security ? "lock.shield" : "square.grid.2x2") }
    }
    @State private var selection: Page? = .display
    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(Page.allCases, selection: $selection) { page in
                Label(page.rawValue, systemImage: page.symbol).tag(page)
            }.navigationTitle("Settings")
                .toolbar(removing: .sidebarToggle)
                .toolbar {
                    #if os(iOS)
                    ToolbarItem(placement: .topBarLeading) { PanelAppBackButton(back: back) }
                        .sharedBackgroundVisibility(.hidden)
                    #else
                    ToolbarItem(placement: .navigation) { PanelAppBackButton(back: back) }
                        .sharedBackgroundVisibility(.hidden)
                    #endif
                }
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 340)
        } detail: {
            NavigationStack {
                Form {
                    if selection == .apps {
                        Section {
                            ForEach(PanelAppCatalog.standard.apps.filter { if case .feature = $0.route { true } else { $0.route == .timer || $0.route == .photoBooth } }) { app in
                                NavigationLink { PanelPerAppSettings(app: app) } label: { Label(app.name, systemImage: app.symbol) }
                            }
                        }
                    } else if selection == .security {
                        Section("Panel PIN") {
                            if let api = integration?.panelPIN {
                                NavigationLink { PanelPINChangePage(api: api) } label: {
                                    Label("Change PIN", systemImage: "key.fill")
                                }.accessibilityIdentifier("settings-change-pin")
                            } else {
                                Label("Connect to your panel server to change the PIN", systemImage: "wifi.slash")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Section {
                            NavigationLink { WallpaperPicker(embedded: true) } label: { Label("Background", systemImage: "photo") }
                        }
                        PanelDisplaySettings()
                    }
                }.formStyle(.grouped)
                    .navigationTitle(selection?.rawValue ?? "Display")
            }.id(selection)
        }.tint(.blue).preferredColorScheme(.dark)
    }
}

/// Icon artwork is separate from the app registration and navigation shell.
struct PanelAppIcon: View {
    let app: PanelAppDefinition
    let side: CGFloat
    private var accent: Color { Color(hex: app.accent) }
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: side * 0.23)
                .fill(LinearGradient(colors: [accent.mix(with: .white, by: 0.18), accent, accent.mix(with: .black, by: 0.3)], startPoint: .topLeading, endPoint: .bottomTrailing))
            if app.id == "calendar" {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    VStack(spacing: 0) {
                        Text(context.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                            .font(.system(size: side * 0.14, weight: .bold)).foregroundStyle(.red)
                        Text(context.date.formatted(.dateTime.day()))
                            .font(.system(size: side * 0.49, weight: .light)).foregroundStyle(.black)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.white)
                }.clipShape(.rect(cornerRadius: side * 0.23))
            } else if app.id == "weather" {
                Circle().fill(.yellow.gradient).frame(width: side * 0.38, height: side * 0.38).offset(x: side * 0.16, y: -side * 0.14)
                Image(systemName: "cloud.fill").font(.system(size: side * 0.49)).foregroundStyle(.white.gradient)
                    .shadow(color: .black.opacity(0.18), radius: 4, y: 3).offset(x: -side * 0.05, y: side * 0.08)
            } else {
                Image(systemName: app.symbol).font(.system(size: side * 0.46, weight: .medium))
                    .symbolRenderingMode(.hierarchical).foregroundStyle(.white.gradient)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 3)
            }
        }.frame(width: side, height: side)
            .overlay { RoundedRectangle(cornerRadius: side * 0.23).strokeBorder(.white.opacity(0.18), lineWidth: 0.5) }
            .accessibilityHidden(true)
    }
}

/// Small, interruptible press feedback; screen navigation itself stays a crossfade.
private struct LauncherPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: configuration.isPressed)
    }
}
