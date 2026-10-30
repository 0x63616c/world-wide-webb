import PanelKit
import SwiftUI

/// Reuses the design worker's Now Playing layout. Rooms is full-screen navigation
/// owned by Hybrid, so prototype presentation and fixture defaults stay unchanged.
struct SonosModule: View {
    let store: LiveHomeDataSource
    var close: () -> Void = {}
    var isFace = false
    @State private var roomsOpen = false
    @State private var selectedID: String?

    var body: some View {
        if roomsOpen {
            SonosRoomsModule(store: store, select: { selectedID = $0; roomsOpen = false }, close: { roomsOpen = false })
        } else {
            NowPlayingView(store: store, close: close, isFace: isFace, selectedRoomID: selectedID,
                showsPlaybackPosition: { store.sonosProvider.playback(for: $0.id) != nil },
                volumeValue: { $0.displayVolume }, volumeCommand: { .volume($0, $1) },
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
        VStack(spacing: 0) {
            HStack {
                Button("Now playing", systemImage: "chevron.left", action: close).buttonStyle(.glass)
                Spacer()
                Menu("Volume settings", systemImage: "slider.horizontal.3") {
                    Button(store.globalLock ? "Unlock global volume" : "Lock global volume") { store.send(.globalLock) }
                    Button(store.groupLock ? "Unlock group volume" : "Lock group volume") { store.send(.groupLock) }
                    Button("Calibrate") { store.send(.calibrate) }
                    Button("Clear calibration") { store.send(.clearCalibration) }
                }.buttonStyle(.glass)
            }.padding(24)
            List(store.sonosProvider.rooms) { room in
                let available = store.sonosProvider.roomDetails[room.id]?.availability == .available
                HStack(spacing: 24) {
                    Button { select(room.id) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(room.name).font(.title2.bold())
                            Text(available ? (room.trackTitle ?? room.sourceLabel ?? "Nothing playing") : "Unavailable")
                                .foregroundStyle(.secondary)
                            Text(room.coordinator == room.id ? "Standalone" : "Grouped with \(room.coordinatorLabel)")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }.frame(width: 300, alignment: .leading)
                    }.buttonStyle(.plain).accessibilityLabel("Now playing in \(room.name)")
                    Button { store.send(.mute(room.id)) } label: {
                        Image(systemName: room.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel("\(room.muted ? "Unmute" : "Mute") \(room.name)")
                    Slider(value: Binding(get: { Double(room.displayVolume) }, set: { store.send(.volume(room.id, Int($0))) }), in: 0...100)
                        .accessibilityLabel("\(room.name) volume")
                    Text("\(room.displayVolume)%").monospacedDigit().frame(width: 65)
                    Menu("Room actions", systemImage: "ellipsis") {
                        Button("Group all with \(room.name)") { store.send(.joinAll(room.id)) }
                        ForEach(store.rooms.filter { $0.id != room.id && $0.coordinator != room.coordinator }) { target in
                            Button("Join \(target.name)") { store.send(.join(room.id, target.id)) }
                        }
                        Button("Make standalone") { store.send(.leave(room.id)) }
                        Divider()
                        Button("TV / Beam input") { store.sonosProvider.selectSource(.tv, room: room.id) }
                        Button("Play TV in all rooms") { store.sonosProvider.selectSource(.joinAllToTV, room: room.id) }
                        Button("Line-in") { store.sonosProvider.selectSource(.lineIn, room: room.id) }
                    }.frame(minWidth: 130).disabled(!available || !store.sonosProvider.pending.isEmpty)
                }.padding(.vertical, 18).disabled(!available)
            }.scrollContentBackground(.hidden)
            Text("Volume is relative to each room’s calibrated baseline.").foregroundStyle(.secondary).padding(24)
        }.accessibilityIdentifier("sonos-rooms")
    }
}

struct SonosArtwork: View {
    let room: SoundRoom
    let api: SonosArtworkAPI
    @State private var image: UIImage?
    // Include metadata so a new track clears the previous cover even if HA reuses its URL.
    private var key: String { "\(room.coordinator)|\(room.albumArtUri ?? "")|\(room.trackTitle ?? "")|\(room.trackArtist ?? "")" }
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFill().accessibilityLabel("Album artwork") }
            else { ContentUnavailableView("Artwork unavailable", systemImage: "music.note") }
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
