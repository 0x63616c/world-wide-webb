// Tapes: a personal library of movies, shows and DJ sets served from the home Mac mini.
// One SwiftUI app for iPhone, Mac and Apple TV; the system player plays the server's MP4s.
import AVKit
import SwiftUI

@main
struct TapesApp: App {
  var body: some Scene {
    WindowGroup {
      RootView()
        #if os(macOS)
          .frame(minWidth: 960, minHeight: 640)
        #endif
    }
    #if os(macOS)
      .defaultSize(width: 1280, height: 820)
      .commands {
        // The sidebar's own toggle, moved from the system default Control-Command-S to Command-B.
        CommandGroup(replacing: .sidebar) {
          Button("Toggle Sidebar") { toggleSidebar() }
          .keyboardShortcut("b", modifiers: .command)
        }
      }
    #endif
  }
}

#if os(macOS)
  /// Asks the window's split view directly: once the sidebar is hidden, nothing in the focus chain
  /// answers the standard toggle action, so sending it the usual way only ever hides.
  private func toggleSidebar() {
    func split(in view: NSView?) -> NSSplitView? {
      guard let view else { return nil }
      if let found = view as? NSSplitView { return found }
      return view.subviews.lazy.compactMap { split(in: $0) }.first
    }
    let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible }
    (split(in: window?.contentView)?.delegate as? NSSplitViewController)?.toggleSidebar(nil)
  }
#endif

struct RootView: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var store = Store()

  var body: some View {
    ZStack {
      // The splash replaces the tabs rather than covering them, so no toolbar or focus shows through.
      switch store.phase {
      case .loading:
        Splash().transition(.opacity)
      case .failed(let message):
        Unreachable(message: message)
      case .ready:
        RootTabs()
      }
    }
    .animation(.easeOut(duration: 0.4), value: store.phase)
    .environment(store)
    .background(Color.black.ignoresSafeArea())
    .preferredColorScheme(.dark)
    // No scroll bars anywhere. `.never` rather than `.hidden`, which a Mac with a mouse ignores.
    .scrollIndicators(.never)
    .tint(.white)
    #if os(macOS)
      // The player fills the window, so the sidebar button and page title must not sit over it.
      .toolbarVisibility(store.nowPlaying == nil ? .automatic : .hidden, for: .windowToolbar)
      .overlay {
        if let playable = store.nowPlaying {
          PlayerScreen(playable: playable, store: store)
          .id(playable.id)
          .background(.black)
          .ignoresSafeArea()
          .overlay(alignment: .topLeading) {
            Button {
              store.nowPlaying = nil
            } label: {
              Image(systemName: "xmark").padding(4)
            }
            .buttonStyle(.glass)
            .keyboardShortcut(.cancelAction)
            .padding(16)
          }
        }
      }
    #else
      .fullScreenCover(item: $store.nowPlaying) { playable in
        PlayerScreen(playable: playable, store: store).ignoresSafeArea()
      }
    #endif
    .task { await store.load() }
    .onChange(of: scenePhase) { _, phase in
      // Pick up imports and progress saved on other devices.
      if phase == .active && store.phase == .ready && store.nowPlaying == nil {
        ImageCache.shared.retryFailures()
        Task { await store.load() }
      }
    }
  }
}

/// Shown when the first load fails: the server is off, or this device is away from home.
private struct Unreachable: View {
  @Environment(Store.self) private var store
  let message: String

  var body: some View {
    ContentUnavailableView {
      Label("Can't Reach Tapes", systemImage: "wifi.exclamationmark")
    } description: {
      Text(
        "Tapes plays from the Mac mini at home, so this device needs to be on the home network.\n\(message)"
      )
    } actions: {
      Button("Try Again") { Task { await store.retry() } }
        .buttonStyle(.glassProminent)
        .tint(.white)
        .foregroundStyle(.black)
    }
    .background(Color.black.ignoresSafeArea())
  }
}

/// Owns the AVPlayer for one viewing and writes the position back while playing and when it ends.
final class PlayerSession {
  let playable: Playable
  let store: Store
  let player: AVPlayer
  private var observer: Any?

  init(playable: Playable, store: Store) {
    self.playable = playable
    self.store = store
    let item = AVPlayerItem(url: store.server.mediaURL(playable.id))
    #if !os(macOS)
      item.externalMetadata = [
        Self.metadata(.commonIdentifierTitle, playable.title),
        Self.metadata(.iTunesMetadataTrackSubTitle, playable.subtitle),
      ]
    #endif
    player = AVPlayer(playerItem: item)
    if store.isInProgress(playable.id) {
      player.seek(to: CMTime(seconds: store.position(playable.id), preferredTimescale: 600))
    }
    // Save every 15 seconds so a crash or a dropped connection loses little.
    observer = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 15, preferredTimescale: 1), queue: .main
    ) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.save() }
    }
    player.play()
  }

  private func save() {
    guard player.timeControlStatus == .playing, let item = player.currentItem else { return }
    store.record(
      playable.id, seconds: player.currentTime().seconds, duration: item.duration.seconds)
  }

  func finish() {
    if let observer { player.removeTimeObserver(observer) }
    observer = nil
    player.pause()
    let duration = player.currentItem?.duration.seconds ?? .nan
    store.record(playable.id, seconds: player.currentTime().seconds, duration: duration)
  }

  private static func metadata(_ identifier: AVMetadataIdentifier, _ value: String)
    -> AVMetadataItem
  {
    let item = AVMutableMetadataItem()
    item.identifier = identifier
    item.value = value as NSString
    item.extendedLanguageTag = "und"
    return item
  }
}

/// The system player on each platform.
#if os(macOS)
  struct PlayerScreen: NSViewRepresentable {
    let playable: Playable
    let store: Store

    func makeCoordinator() -> PlayerSession { PlayerSession(playable: playable, store: store) }

    func makeNSView(context: Context) -> AVPlayerView {
      let view = AVPlayerView()
      view.controlsStyle = .floating
      view.player = context.coordinator.player
      return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {}

    static func dismantleNSView(_ view: AVPlayerView, coordinator: PlayerSession) {
      coordinator.finish()
    }
  }
#else
  struct PlayerScreen: UIViewControllerRepresentable {
    let playable: Playable
    let store: Store

    func makeCoordinator() -> PlayerSession { PlayerSession(playable: playable, store: store) }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
      let controller = AVPlayerViewController()
      controller.player = context.coordinator.player
      return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}

    static func dismantleUIViewController(
      _ controller: AVPlayerViewController, coordinator: PlayerSession
    ) {
      coordinator.finish()
    }
  }
#endif
