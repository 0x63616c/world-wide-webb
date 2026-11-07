import SwiftUI

struct SonosRoomsPage: View {
    let store: any HomeDataSource
    var playEverywhere: (() -> Void)? = nil
    var busy = false

    @State private var dragPreview: VolumePreview?

    private struct VolumePreview {
        let roomIDs: Set<String>
        let value: Int
    }

    private var tv: SoundRoom? {
        store.rooms.first { $0.id == "media_player.living_room" } ??
            store.rooms.first { $0.name == "Living Room" }
    }
    private var speakers: [SoundRoom] { store.rooms.filter { $0.id != tv?.id } }

    private var masterVolume: Int {
        let volumes = speakers.map { shownVolume(for: $0) }
        guard !volumes.isEmpty else { return 0 }
        return Int((Double(volumes.reduce(0, +)) / Double(volumes.count)).rounded())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                GlassEffectContainer(spacing: 12) {
                    VStack(spacing: 16) {
                        master
                        Divider()
                        ForEach(speakers) { room in
                            roomVolume(room, title: room.name, symbol: "speaker.wave.2.fill")
                        }
                        if let tv {
                            Divider()
                            roomVolume(tv, title: "TV", symbol: "tv")
                        }
                    }
                }
            }
            .frame(maxWidth: 640)
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center, for: .alignment)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Home").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                if let playEverywhere { playEverywhere() }
                else if let desk = speakers.first(where: { $0.name == "Desk" }) {
                    for room in speakers where room.id != desk.id { store.send(.join(room.id, desk.id)) }
                }
            } label: {
                Label("Play everywhere", systemImage: "hifispeaker.2")
                    .font(.subheadline.weight(.semibold)).padding(10)
            }
            .buttonStyle(.glass)
            .accessibilityHint("Plays Desk’s line-in on the Home speakers")
            .disabled(busy)
        }
    }

    private var master: some View {
        VStack(spacing: 16) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Master").font(.title3.weight(.semibold))
                    Text("Home speakers").font(.caption).foregroundStyle(.secondary)
                }
                Button {
                    store.send(.globalLock)
                } label: {
                    Image(systemName: store.globalLock ? "lock.fill" : "lock.open")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Link Home speaker volumes")
                .accessibilityHint("Moving a Home speaker volume adjusts the other Home speakers")
                .accessibilityAddTraits(store.globalLock ? .isSelected : [])
                .accessibilityIdentifier("sonos-volume-lock")
                Spacer()
                percentage(masterVolume, id: "master")
            }
            volumeBar(value: masterVolume, title: "Master", symbol: "hifispeaker.2.fill")
        }
        .disabled(speakers.isEmpty)
    }

    private func shownVolume(for room: SoundRoom) -> Int {
        if let dragPreview, dragPreview.roomIDs.contains(room.id) {
            return dragPreview.value
        }
        return room.rawVolume
    }

    private func roomVolume(_ room: SoundRoom, title: String, symbol: String) -> some View {
        let value = shownVolume(for: room)
        return VStack(spacing: 6) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                percentage(value, id: room.id)
            }
            volumeBar(value: value, title: title, symbol: symbol, roomID: room.id)
        }
    }

    private func percentage(_ value: Int, id: String) -> some View {
        Text("\(value)%")
            .font(.body.monospacedDigit())
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("sonos-percent-\(id)")
    }

    private func volumeBar(value: Int, title: String, symbol: String, roomID: String? = nil) -> some View {
        let targetIDs: Set<String>
        if let roomID, !store.globalLock || roomID == tv?.id {
            targetIDs = [roomID]
        } else {
            targetIDs = Set(speakers.map(\.id))
        }
        return FilledLevelControl(value: value, label: "\(title) volume", symbol: symbol, preview: { value in
            dragPreview = value.map { VolumePreview(roomIDs: targetIDs, value: $0) }
        }) { value in
            store.send(.roomVolumes(targetIDs, value))
        }
        .frame(height: 58)
        .accessibilityIdentifier("sonos-volume-\(roomID ?? "master")")
    }
}
