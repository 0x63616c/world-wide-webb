// Tapes: a personal library of movies, shows and DJ sets served from the home Mac mini.
// One SwiftUI app for iPhone, Mac and Apple TV; the system player plays the server's MP4s.
import AVKit
import SwiftUI

@main
struct TapesApp: App {
  #if !os(macOS)
    init() {
      // Film sound: plays with the ring/silent switch on, routes to AirPlay and allows PiP.
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }
  #endif

  var body: some Scene {
    WindowGroup {
      RootView()
        #if os(macOS)
          .frame(minWidth: 960, minHeight: 640)
        #endif
    }
    #if os(macOS)
      .defaultSize(width: 1280, height: 820)
    #endif
  }
}

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
        LoadFailure(
          title: "Can't Reach Tapes", systemImage: "wifi.exclamationmark",
          message:
            "Tapes plays from the Mac mini at home, so this device needs to be on the home network.\n\(message)"
        )
      case .unreadable:
        LoadFailure(
          title: "Can't Read the Library", systemImage: "externaldrive.badge.exclamationmark",
          message:
            "The Mac mini is running, but it can't read the library on the NAS. Check that the NAS is on, then try again."
        )
      case .ready:
        RootTabs()
      }
    }
    // Fill the window, so a small screen like the load failure isn't a black box on grey.
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .animation(.easeOut(duration: 0.4), value: store.phase)
    .environment(store)
    .background(Color.black.ignoresSafeArea())
    .preferredColorScheme(.dark)
    // No scroll bars anywhere. `.never` rather than `.hidden`, which a Mac with a mouse ignores.
    .scrollIndicators(.never)
    .tint(.white)
    #if os(macOS)
      // Every screen sits on the black page: no grey title strip and no "Tapes" title above it.
      .toolbar(removing: .title)
      .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
      // The player fills the window, so the tabs must not sit over it.
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

/// Shown when the first load fails: the server is off, this device is away from home, or the
/// server can't read the NAS.
private struct LoadFailure: View {
  @Environment(Store.self) private var store
  let title: String
  let systemImage: String
  let message: String

  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: systemImage)
    } description: {
      Text(message)
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
/// When an episode plays to the end, the show's next episode starts in the same player.
final class PlayerSession {
  private(set) var playable: Playable
  let store: Store
  let player = AVPlayer()
  private var observer: Any?
  private var endObserver: NSObjectProtocol?
  private var artwork: Task<Void, Never>?

  init(playable: Playable, store: Store) {
    self.playable = playable
    self.store = store
    // Save every 15 seconds so a crash or a dropped connection loses little.
    observer = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 15, preferredTimescale: 1), queue: .main
    ) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.save() }
    }
    start(playable)
  }

  private func start(_ playable: Playable) {
    self.playable = playable
    let item = AVPlayerItem(url: store.server.mediaURL(playable.id))
    #if !os(macOS)
      item.externalMetadata = Self.metadata(playable, artwork: nil)
      artwork?.cancel()
      if let artID = playable.artID {
        let url = store.server.artURL(artID, small: false)
        // The info panel and the remote's Now Playing show the poster once it arrives.
        artwork = Task { [weak item] in
          guard let (data, response) = try? await URLSession.shared.data(from: url),
            (response as? HTTPURLResponse)?.statusCode == 200, !Task.isCancelled, let item
          else { return }
          item.externalMetadata = Self.metadata(playable, artwork: data)
        }
      }
    #endif
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.playNext() }
    }
    player.replaceCurrentItem(with: item)
    if store.isInProgress(playable.id) {
      player.seek(to: CMTime(seconds: store.position(playable.id), preferredTimescale: 600))
    }
    player.play()
  }

  private func save() {
    guard player.timeControlStatus == .playing, let item = player.currentItem else { return }
    store.record(
      playable.id, seconds: player.currentTime().seconds, duration: item.duration.seconds)
  }

  /// Marks the finished item watched and moves on to the next episode, if there is one.
  private func playNext() {
    let duration = player.currentItem?.duration.seconds ?? .nan
    store.record(playable.id, seconds: duration, duration: duration)
    if let next = store.playable(after: playable.id) { start(next) }
  }

  func finish() {
    if let observer { player.removeTimeObserver(observer) }
    observer = nil
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = nil
    artwork?.cancel()
    player.pause()
    let duration = player.currentItem?.duration.seconds ?? .nan
    store.record(playable.id, seconds: player.currentTime().seconds, duration: duration)
  }

  #if !os(macOS)
    private static func metadata(_ playable: Playable, artwork: Data?) -> [AVMetadataItem] {
      var items = [
        metadata(.commonIdentifierTitle, playable.title as NSString),
        metadata(.iTunesMetadataTrackSubTitle, playable.subtitle as NSString),
      ]
      if let artwork {
        let item = metadata(.commonIdentifierArtwork, artwork as NSData)
        item.dataType = kCMMetadataBaseDataType_JPEG as String
        items.append(item)
      }
      return items
    }

    private static func metadata(
      _ identifier: AVMetadataIdentifier, _ value: NSCopying & NSObjectProtocol
    ) -> AVMutableMetadataItem {
      let item = AVMutableMetadataItem()
      item.identifier = identifier
      item.value = value
      item.extendedLanguageTag = "und"
      return item
    }
  #endif
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
