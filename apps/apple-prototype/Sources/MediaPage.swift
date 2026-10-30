import SwiftUI
import AVKit

struct MediaPage: View {
    let provider: any MediaProvider
    let store: any HomeDataSource
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var roomID = "Living Room"
    @State private var playingTitle: String?
    @State private var showingVideo = false
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                HStack {
                    Text("Your library").font(.system(size: compact ? 32 : 48, weight: .bold))
                    Spacer()
                    Menu {
                        ForEach(store.rooms) { room in Button(room.name) { roomID = room.id } }
                    } label: {
                        Label(roomID, systemImage: "hifispeaker.fill").font(.system(size: compact ? 15 : 20)).padding(10)
                    }.buttonStyle(.glass)
                }
                Text(playingTitle.map { "Playing \($0) in \(roomID)" } ?? "Choose music for a room, or a film for this screen.")
                    .font(.system(size: compact ? 16 : 22)).foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: compact ? 2 : 4), alignment: .leading, spacing: 32) {
                    ForEach(provider.items) { item in
                        Button {
                            if item.kind == .video { showingVideo = true }
                            else { store.send(.playMedia(roomID, item.trackIndex)); playingTitle = item.title }
                        } label: {
                            VStack(alignment: .leading, spacing: 16) {
                                ZStack(alignment: .bottomTrailing) {
                                    if item.kind == .video {
                                        GeometryReader { imageProxy in
                                            Image("LakeWallpaper").resizable().scaledToFill()
                                                .frame(width: imageProxy.size.width, height: imageProxy.size.height).clipped()
                                        }
                                    } else { FixtureArtwork(tint: item.tint) }
                                    Image(systemName: "play.fill").font(.system(size: 22)).padding(18).glassEffect(.regular, in: .circle).padding(16)
                                }.aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: compact ? 24 : 32))
                                Text(item.title).font(.system(size: compact ? 19 : 25, weight: .semibold)).lineLimit(2)
                                Text(item.subtitle).font(.system(size: compact ? 14 : 18)).foregroundStyle(.secondary).lineLimit(2)
                            }.frame(maxHeight: .infinity, alignment: .top)
                        }.buttonStyle(.plain).accessibilityLabel(item.kind == .video ? "Play \(item.title) on this screen" : "Play \(item.title) in \(roomID)")
                    }
                }
                Text("Original fixture music · Licensed landscape film").font(.system(size: 16)).foregroundStyle(.secondary).padding(.top, 16)
            }.padding(compact ? 24 : 64)
        }.sheet(isPresented: $showingVideo) {
            LocalVideoPage(url: provider.videoURL, close: { showingVideo = false })
                .presentationSizing(.page)
        }.task {
            if ProcessInfo.processInfo.arguments.contains("-showVideo") { showingVideo = true }
        }
    }
}
struct LocalVideoPage: View {
    let url: URL?
    let close: () -> Void
    @State private var player = AVPlayer()
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: player).ignoresSafeArea()
            HStack {
                CircleButton(symbol: "xmark", label: "Close video", size: 48, action: close)
                Spacer()
                Text("A moment by the lake").font(.headline).padding(16).glassEffect(.regular, in: .capsule)
            }.padding(24)
        }.onAppear {
            guard let url else { return }
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            if ProcessInfo.processInfo.arguments.contains("-snapshot") { player.seek(to: CMTime(seconds: 2, preferredTimescale: 600)) }
            else { player.play() }
        }.onDisappear { player.pause(); player.replaceCurrentItem(with: nil) }
    }
}
