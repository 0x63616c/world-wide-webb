import PanelKit
import SwiftUI

/// Reuses the design worker's Now Playing layout. Rooms is full-screen navigation
/// owned by Hybrid, so prototype presentation and fixture defaults stay unchanged.
struct SonosModule: View {
    let store: LiveHomeDataSource
    var close: () -> Void = {}
    var isFace = false
    @State private var roomsOpen = true
    @State private var selectedID: String?

    var body: some View {
        if roomsOpen {
            SonosRoomsModule(
                store: store,
                select: {
                    selectedID = $0
                    roomsOpen = false
                }, close: { roomsOpen = false })
        } else {
            NowPlayingView(
                store: store, close: close, isFace: isFace, selectedRoomID: selectedID,
                showsPlaybackPosition: { store.sonosProvider.playback(for: $0.id) != nil },
                volumeValue: { $0.rawVolume }, volumeCommand: { .rawVolume($0, $1) },
                artworkContent: { AnyView(SonosArtwork(room: $0, api: store.sonosArtwork)) },
                openRooms: { roomsOpen = true })
        }
    }
}

struct SonosRoomsModule: View {
    let store: LiveHomeDataSource
    let select: (String) -> Void
    let close: () -> Void

    var body: some View {
        SonosRoomsPage(
            store: store,
            playDeskLineIn: {
                store.sonosProvider.groupLineIn(sourceID: "media_player.desk", excluding: ["media_player.living_room"])
            }, busy: !store.sonosProvider.pending.isEmpty
        )
        .accessibilityIdentifier("sonos-rooms")
    }
}

struct SonosArtwork: View {
    let room: SoundRoom
    let api: SonosArtworkAPI
    var compact = false
    @State private var image: UIImage?
    // Include metadata so a new track clears the previous cover even if HA reuses its URL.
    private var key: String {
        "\(room.coordinator)|\(room.albumArtUri ?? "")|\(room.trackTitle ?? "")|\(room.trackArtist ?? "")"
    }
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().accessibilityLabel("Album artwork")
            } else if compact {
                Image(systemName: room.sourceKind == .tv ? "tv" : "music.note")
                    .font(.system(size: 30)).foregroundStyle(.white.opacity(0.65))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.white.opacity(0.06)).accessibilityLabel("Artwork unavailable")
            } else {
                VStack(spacing: 24) {
                    Image(
                        systemName: room.sourceKind == .tv
                            ? "tv" : room.sourceKind == .lineIn ? "cable.connector" : "music.note"
                    )
                    .font(.system(size: 96, weight: .light)).foregroundStyle(.white.opacity(0.85))
                    Text(
                        room.sourceKind == .tv
                            ? "TV audio" : room.sourceKind == .lineIn ? "Home" : room.sourceLabel ?? "Sonos"
                    )
                    .font(.title2.weight(.medium))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(
                        LinearGradient(
                            colors: [.indigo.opacity(0.3), .black], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
        }.task(id: key) {
            image = nil
            guard room.albumArtUri != nil else { return }
            do {
                let bytes = try await api.artwork(room: room.coordinator)
                try Task.checkCancellation()
                image = UIImage(data: bytes)
            } catch { if !Task.isCancelled { image = nil } }
        }
    }
}
