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
                GlassEffectContainer(spacing: 32) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 28), count: columns), spacing: 48) {
                        ForEach(apps) { app in
                            Button { open(app) } label: {
                                VStack(spacing: 14) {
                                    LauncherIcon(app: app, side: iconSide)
                                        .matchedTransitionSource(id: app.id, in: namespace)
                                    Text(app.name).font(.system(size: sizeClass == .compact ? 15 : 21, weight: .medium))
                                        .foregroundStyle(.white).lineLimit(1)
                                }.frame(maxWidth: .infinity).contentShape(.rect)
                            }.buttonStyle(.plain).accessibilityIdentifier("app-\(app.id)")
                        }
                    }.padding(.horizontal, sizeClass == .compact ? 20 : 72)
                        .padding(.vertical, 48)
                }.frame(minHeight: proxy.size.height, alignment: .center)
            }.scrollIndicators(.hidden)
        }.background { Wallpaper(dimming: 0.12, blurRadius: 0) }
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
    let showClock: () -> Void
    @State private var choosingWallpaper = false
    @AppStorage("panel.idleDimming") private var idleDimming = true
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { choosingWallpaper = true } label: { Label("Background", systemImage: "photo") }
                    Toggle("Dim when idle", isOn: $idleDimming).tint(.green)
                }
                Section {
                    Button(action: showClock) { Label("Show clock", systemImage: "clock") }
                }
            }.formStyle(.grouped).scrollContentBackground(.hidden)
                .navigationTitle("Settings")
                .background(Color.black)
                .sheet(isPresented: $choosingWallpaper) { WallpaperPicker() }
        }.preferredColorScheme(.dark)
    }
}

/// Icon artwork is separate from the app registration and navigation shell.
private struct LauncherIcon: View {
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
