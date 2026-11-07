import AVKit
import PanelKit
import SwiftUI

/// The prototype MediaPage assumes fixture music, room playback, and artwork.
/// Keep it unchanged; the hybrid adapter exposes only supported video playback.
struct MediaModule: View {
    let provider: LiveMediaProvider
    let detail: Bool
    let open: () -> Void
    @State private var selectedID: String?

    var body: some View {
        Group {
            if !detail {
                Button(action: open) {
                    VStack(spacing: 20) {
                        Label("Media", systemImage: "play.rectangle")
                            .font(.largeTitle)
                        Text("\(provider.items.count) videos").foregroundStyle(.secondary)
                        Text("Open library").font(.headline)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }.buttonStyle(.plain)
            } else if let selectedID, let item = provider.items.first(where: { $0.id == selectedID }),
                      let stream = provider.stream(for: selectedID) {
                MediaPlayerPage(stream: stream, title: item.title, close: { self.selectedID = nil })
                    .id(stream.url)
            } else {
                List(provider.items) { item in
                    Button { selectedID = item.id } label: {
                        HStack(spacing: 20) {
                            Image(systemName: "play.circle").font(.title)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.title).font(.headline)
                                if !item.subtitle.isEmpty { Text(item.subtitle).foregroundStyle(.secondary) }
                            }
                        }.padding(.vertical, 12)
                    }.accessibilityLabel("Play \(item.title) on this screen")
                }.scrollContentBackground(.hidden)
            }
        }.task {
            #if DEBUG
            if detail, ProcessInfo.processInfo.arguments.contains("-hybridFixtures"),
               ProcessInfo.processInfo.arguments.contains("-hybridMediaPlay") {
                selectedID = provider.items.first?.id
            }
            #endif
        }
    }
}

private struct MediaPlayerPage: View {
    let stream: MediaStream
    let title: String
    let close: () -> Void
    @State private var player = AVPlayer()
    @State private var playback: MediaPlayback?
    @State private var failed = false
    @State private var observation: NSKeyValueObservation?

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("Library", systemImage: "chevron.left", action: close).buttonStyle(.glass)
                Text(title).font(.headline)
                Spacer()
            }.padding(.horizontal, 24)
            if failed {
                ContentUnavailableView("Video unavailable", systemImage: "play.slash",
                                       description: Text("Return to the library and try again."))
            } else {
                VideoPlayer(player: player)
            }
        }.onAppear {
            let playback = MediaPlayback(stream: stream)
            self.playback = playback
            player.allowsExternalPlayback = false // Access credentials are local to this loader.
            observation = playback.item.observe(\.status, options: [.initial, .new]) { item, _ in
                let failed = item.status == .failed
                Task { @MainActor in self.failed = failed }
            }
            player.replaceCurrentItem(with: playback.item)
            player.play()
        }.onDisappear {
            observation?.invalidate(); observation = nil
            player.pause(); player.replaceCurrentItem(with: nil)
            playback?.stop(); playback = nil
        }
    }
}
