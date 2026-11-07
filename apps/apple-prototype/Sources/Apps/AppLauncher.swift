import SwiftUI
import PanelKit

struct AppLauncher: View {
    let apps: [PanelAppDefinition]
    let open: (PanelAppDefinition) -> Void
    let close: () -> Void
    let isPresented: Bool
    let namespace: Namespace.ID
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var isAtTop = true
    @State private var swipeStartedAtTop: Bool?
    var body: some View {
        GeometryReader { proxy in
            let columns = sizeClass == .compact ? 3 : 5
            let iconFrameSide: CGFloat = sizeClass == .compact ? 76 : 112
            let iconSide = iconFrameSide * 0.9
            let headerInset: CGFloat = sizeClass == .compact ? 20 : 40
            let firstRowTop = headerInset + PanelProfilePhoto.side + 24
            ZStack(alignment: .topTrailing) {
            ScrollView(.vertical) {
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
                .simultaneousGesture(DragGesture(minimumDistance: 12)
                    .onChanged { _ in
                        if swipeStartedAtTop == nil { swipeStartedAtTop = isAtTop }
                    }
                    .onEnded { value in
                        defer { swipeStartedAtTop = nil }
                        guard isPresented, swipeStartedAtTop == true,
                              value.translation.height > abs(value.translation.width),
                              value.translation.height > 80 || value.predictedEndTranslation.height > 180 else { return }
                        close()
                    })
                if isPresented {
                    PanelProfilePhoto()
                        .padding(headerInset)
                        .zIndex(1)
                }
            }
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
    static var blurRadius: CGFloat {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-previewLauncherBlur"), args.indices.contains(index + 1),
           let value = Double(args[index + 1]) {
            return CGFloat(max(0, min(value, 3)))
        }
        #endif
        return 3
    }
    static var edgeOpacity: Double {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-previewLauncherEdge"), args.indices.contains(index + 1),
           let value = Double(args[index + 1]) {
            return max(0, min(value, 0.75))
        }
        #endif
        return 0.75
    }
    static var edgeWidth: CGFloat {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-previewLauncherEdgeWidth"), args.indices.contains(index + 1),
           let value = Double(args[index + 1]) {
            return CGFloat(max(0, min(value, 10)))
        }
        #endif
        return 10
    }
    static var footprint: some View {
        RoundedRectangle(cornerRadius: PanelSurface.cornerRadius - edgeInset)
            .padding(edgeInset)
    }
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PanelSurface.cornerRadius - Self.edgeInset)
        Color.clear.glassEffect(preview == "regular" ? .regular.tint(.white.opacity(0.06)) : .clear, in: shape)
            .background(.black.opacity(preview == "clearDim" ? 0.22 : 0), in: shape)
            .padding(Self.edgeInset)
    }

    private var preview: String {
        #if DEBUG
        if let value = UserDefaults.standard.string(forKey: "previewLauncherGlass"),
           value == "clear" || value == "clearDim" { return value }
        #endif
        return "regular"
    }
}

/// This sits in the clock layer, below the native glass, so the glass can refract it.
struct LauncherGlassOutline: View {
    private let innerInset: CGFloat = 4
    var body: some View {
        let inset = LauncherGlassSurface.edgeInset + innerInset
        RoundedRectangle(cornerRadius: PanelSurface.cornerRadius - inset)
            .strokeBorder(
                LinearGradient(colors: [.white.opacity(LauncherGlassSurface.edgeOpacity),
                                        .white.opacity(LauncherGlassSurface.edgeOpacity * 0.25)],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                lineWidth: LauncherGlassSurface.edgeWidth)
            .padding(inset)
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
