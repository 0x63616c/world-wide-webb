import PanelKit
import SwiftUI

struct AppLauncher: View {
    let apps: [PanelAppDefinition]
    let open: (PanelAppDefinition) -> Void
    let close: () -> Void
    let isPresented: Bool
    let namespace: Namespace.ID
    @Environment(\.panelContentInsets) private var contentInsets
    @State private var isAtTop = true
    @State private var swipeStartedAtTop: Bool?
    var body: some View {
        GeometryReader { proxy in
            let width = max(1, proxy.size.width - contentInsets.leading - contentInsets.trailing)
            let height = max(1, proxy.size.height - contentInsets.top - contentInsets.bottom)
            let canvas = PanelCanvasProfile.resolve(size: CGSize(width: width, height: height))
            let layout = LauncherLayout(profile: canvas, availableWidth: width, availableHeight: height)
            let columns = layout.columns
            let iconFrameSide = layout.iconFrameSide
            let iconSide = iconFrameSide * 0.9
            let headerInset = layout.headerInset
            let profileFitsBesideGrid = contentInsets.trailing >= PanelProfileSelector.avatarSide + 16
            let firstRowTop = headerInset + (profileFitsBesideGrid ? 0 : PanelProfileSelector.avatarSide + 24)
            ScrollView(.vertical) {
                GlassEffectContainer(spacing: 32) {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: layout.columnSpacing), count: columns),
                        spacing: layout.rowSpacing
                    ) {
                        ForEach(apps) { app in
                            Button {
                                open(app)
                            } label: {
                                VStack(spacing: 14) {
                                    LauncherAppIcon(app: app, side: iconSide)
                                        .matchedTransitionSource(id: app.id, in: namespace) { source in
                                            source.clipShape(.rect(cornerRadius: iconSide * 0.25, style: .continuous))
                                        }
                                        .frame(width: iconFrameSide, height: iconFrameSide)
                                    Text(app.name).font(.system(size: layout.labelSize, weight: .medium))
                                        .foregroundStyle(.white).lineLimit(1)
                                }.frame(maxWidth: .infinity).contentShape(.rect)
                            }.buttonStyle(LauncherPressStyle()).accessibilityIdentifier("app-\(app.id)")
                        }
                    }.padding(.horizontal, layout.horizontalInset)
                        .padding(.top, firstRowTop)
                        .padding(.bottom, layout.bottomInset)
                }
                .frame(minHeight: height, alignment: .top)
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
                .padding(contentInsets)
                .modifier(PanelProfileSelector(isAvailable: isPresented, inset: headerInset))
        }
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
        let shape = ConcentricRectangle()
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
        case diagnostics = "Diagnostics"
        var id: String { rawValue }
        var symbol: String {
            switch self {
            case .display: "display"
            case .security: "lock.shield"
            case .diagnostics: "waveform.path.ecg"
            }
        }
    }
    @State private var selection: Page? = .display
    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(Page.allCases, selection: $selection) { page in
                Label(page.rawValue, systemImage: page.symbol).tag(page)
            }
            .scrollContentBackground(.hidden)
            .background(Color.black)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationTitle("Settings")
            .toolbar(removing: .sidebarToggle)
            .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 340)
        } detail: {
            NavigationStack {
                Group {
                    if selection == .diagnostics {
                        PanelDiagnosticsView(
                            store: (integration as? PanelHomePresentation)?.store, close: {}, embedded: true)
                    } else {
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
                                        Label(
                                            "Connect to your panel server to change the PIN", systemImage: "wifi.slash"
                                        )
                                        .foregroundStyle(.secondary)
                                    }
                                }
                            } else {
                                PanelDisplaySettings()
                            }
                        }.formStyle(.grouped)
                    }
                }
                .navigationTitle(selection?.rawValue ?? "Display")
            }.id(selection)
        }
        .overlay(alignment: .topTrailing) {
            PanelAppBackButton(back: back).padding(.horizontal, 24).padding(.top, 16)
        }
        .onChange(of: selection) { _, page in
            if let page {
                PanelEventLog.shared.record(
                    category: "navigation", action: "settings.\(page.rawValue.lowercased()).open")
            }
        }
        .task {
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-previewDiagnostics") { selection = .diagnostics }
            #endif
        }
        .tint(.blue).preferredColorScheme(.dark)
    }
}

/// Small, interruptible press feedback; native zoom handles app presentation.
private struct LauncherPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.launcherIconPressed, configuration.isPressed)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.smooth(duration: 0.2), value: configuration.isPressed)
    }
}
