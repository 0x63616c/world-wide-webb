import PanelKit
import SwiftUI

struct AppLauncher: View {
    let apps: [PanelAppDefinition]
    let open: (PanelAppDefinition) -> Void
    let close: () -> Void
    let isPresented: Bool
    let namespace: Namespace.ID
    @Environment(\.panelCanvasProfile) private var canvas
    @Environment(\.panelContentInsets) private var contentInsets
    @State private var isAtTop = true
    @State private var swipeStartedAtTop: Bool?
    var body: some View {
        GeometryReader { proxy in
            let layout = LauncherLayout(profile: canvas)
            let columns = layout.columns
            let iconFrameSide = layout.iconFrameSide
            let iconSide = iconFrameSide * 0.9
            let headerInset = layout.headerInset
            let firstRowTop = headerInset + PanelProfileSelector.avatarSide + 24
            ScrollView(.vertical) {
                GlassEffectContainer(spacing: 32) {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 28), count: columns),
                        spacing: layout.rowSpacing
                    ) {
                        ForEach(apps) { app in
                            Button {
                                open(app)
                            } label: {
                                VStack(spacing: 14) {
                                    LauncherAppIcon(app: app, side: iconSide)
                                        .matchedTransitionSource(id: app.id, in: namespace)
                                        .frame(width: iconFrameSide, height: iconFrameSide)
                                    Text(app.name).font(.system(size: layout.labelSize, weight: .medium))
                                        .foregroundStyle(.white).lineLimit(1)
                                }.frame(maxWidth: .infinity).contentShape(.rect)
                            }.buttonStyle(LauncherPressStyle()).accessibilityIdentifier("app-\(app.id)")
                        }
                    }.padding(.horizontal, layout.horizontalInset)
                        .padding(.top, firstRowTop)
                        .padding(.bottom, 48)
                }
                .frame(minHeight: proxy.size.height, alignment: .top)
            }.scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize)
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y <= -geometry.contentInsets.top + 1
                } action: { _, atTop in
                    isAtTop = atTop
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { _ in
                            if swipeStartedAtTop == nil { swipeStartedAtTop = isAtTop }
                        }
                        .onEnded { value in
                            defer { swipeStartedAtTop = nil }
                            guard isPresented, swipeStartedAtTop == true,
                                value.translation.height > abs(value.translation.width),
                                value.translation.height > 80 || value.predictedEndTranslation.height > 180
                            else { return }
                            close()
                        }
                )
                .modifier(PanelProfileSelector(isAvailable: isPresented, inset: headerInset))
        }
        .padding(contentInsets)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("app-launcher")
        .accessibilityAction(named: "Return to clock") { close() }
    }
}

/// Native Liquid Glass above the clock.
/// The inset and concentric corners leave a slim, uninterrupted rim of the dial.
struct LauncherGlassSurface: View {
    static let edgeInset: CGFloat = 8
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PanelSurface.cornerRadius - Self.edgeInset)
        Color.clear.glassEffect(preview == "regular" ? .regular.tint(.white.opacity(0.06)) : .clear, in: shape)
            .background(.black.opacity(preview == "clearDim" ? 0.22 : 0), in: shape)
            .padding(Self.edgeInset)
    }

    private var preview: String {
        #if DEBUG
            if let value = UserDefaults.standard.string(forKey: "previewLauncherGlass"),
                value == "clear" || value == "clearDim"
            {
                return value
            }
        #endif
        return "regular"
    }
}

struct PanelSettingsPage: View {
    let back: () -> Void
    @Environment(\.homeIntegration) private var integration
    private enum Page: String, CaseIterable, Identifiable {
        case display = "Display"
        case security = "Security"
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
                        PanelConnectionSettings()
                        Section("Panel PIN") {
                            if let api = integration?.panelPIN {
                                NavigationLink {
                                    PanelPINChangePage(api: api)
                                } label: {
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
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.launcherIconPressed, configuration.isPressed)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.smooth(duration: 0.2), value: configuration.isPressed)
    }
}
