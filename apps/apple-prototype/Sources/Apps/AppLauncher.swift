import SwiftUI
import PanelKit

struct AppLauncher: View {
    let apps: [PanelAppDefinition]
    let open: (PanelAppDefinition) -> Void
    let close: () -> Void
    let isPresented: Bool
    let namespace: Namespace.ID
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        GeometryReader { proxy in
            let columns = sizeClass == .compact ? 3 : 5
            let iconFrameSide: CGFloat = sizeClass == .compact ? 76 : 112
            let iconSide = iconFrameSide * 0.9
            ZStack(alignment: .topTrailing) {
            ScrollView(.vertical) {
                VStack(spacing: 32) {
                    TimelineView(.everyMinute) { context in
                        let hour = Calendar.current.component(.hour, from: context.date)
                        let greeting = hour < 5 || hour >= 21 ? "GOOD NIGHT" :
                            hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING"
                        Text("\(greeting), CALUM")
                            .font(.system(size: sizeClass == .compact ? 18 : 26, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.leading, sizeClass == .compact ? 20 : 72)
                    .padding(.trailing, 132)
                    .padding(.top, 40)
                GlassEffectContainer(spacing: 32) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 28), count: columns), spacing: 48) {
                        ForEach(apps) { app in
                            Button { open(app) } label: {
                                VStack(spacing: 14) {
                                    LauncherAppIcon(app: app, side: iconSide)
                                        .matchedTransitionSource(id: app.id, in: namespace)
                                        .frame(width: iconFrameSide, height: iconFrameSide)
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
                if isPresented {
                    HStack(spacing: 8) {
                        PanelProfilePhoto()
                    Button(action: close) {
                        Image(systemName: "xmark")
                            .font(.system(size: 20, weight: .semibold))
                            .frame(width: 48, height: 48)
                            .contentShape(.rect)
                    }.buttonStyle(.plain)
                        .frame(width: 48, height: 48)
                        .accessibilityLabel("Close Home")
                        .accessibilityIdentifier("home-close")
                    }
                        .padding(24)
                        .zIndex(1)
                }
            }
        }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("app-launcher")
    }
}

/// Native Liquid Glass above the clock.
/// The inset and concentric corners leave a slim, uninterrupted rim of the dial.
struct LauncherGlassSurface: View {
    private let edgeInset: CGFloat = 8
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PanelSurface.cornerRadius - edgeInset)
        Color.clear.glassEffect(.regular.tint(.white.opacity(0.06)), in: shape)
            .padding(edgeInset)
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
        case display = "Display", security = "Security"
        var id: String { rawValue }
        var symbol: String { self == .display ? "display" : "lock.shield" }
    }
    @State private var selection: Page? = .display
    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(Page.allCases, selection: $selection) { page in
                Label(page.rawValue, systemImage: page.symbol).tag(page)
            }.navigationTitle("Settings")
                .toolbar(removing: .sidebarToggle)
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 340)
        } detail: {
            NavigationStack {
                Form {
                    if selection == .security {
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
                        PanelDisplaySettings()
                    }
                }.formStyle(.grouped)
                    .navigationTitle(selection?.rawValue ?? "Display")
            }.id(selection)
        }
        .overlay(alignment: .topTrailing) {
            PanelAppBackButton(back: back).padding(.horizontal, 24).padding(.top, 16)
        }
        .tint(.blue).preferredColorScheme(.dark)
    }
}

/// Small, interruptible press feedback; screen navigation itself stays a crossfade.
private struct LauncherPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.launcherIconPressed, configuration.isPressed)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: configuration.isPressed)
    }
}
