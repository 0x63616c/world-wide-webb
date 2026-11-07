import SwiftUI

struct SonosRoomsPage: View {
    let store: any HomeDataSource
    var playDeskLineIn: (() -> Void)? = nil
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
    private var desk: SoundRoom? {
        speakers.first { $0.id == "media_player.desk" } ??
            speakers.first { $0.name == "Desk" }
    }

    private var groupedPlayback: String? {
        guard let desk, desk.sourceKind == .lineIn, speakers.count > 1,
              speakers.allSatisfy({ $0.coordinator == desk.id }) else { return nil }
        switch desk.transportState {
        case "PLAYING": return "Playing together · \(speakers.count) rooms"
        case "PAUSED_PLAYBACK": return "Grouped · paused"
        default: return nil
        }
    }

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
                        volumeRow(value: masterVolume, title: "Master", symbol: "hifispeaker.2.fill")
                            .disabled(speakers.isEmpty)
                        Divider()
                        ForEach(speakers) { room in
                            volumeRow(value: shownVolume(for: room), title: room.name, symbol: "speaker.wave.2.fill", roomID: room.id)
                        }
                        if let tv {
                            Divider()
                            volumeRow(value: shownVolume(for: tv), title: "TV", symbol: "tv", roomID: tv.id)
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
            Text("Sonos").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Spacer()
            if let groupedPlayback {
                Label(groupedPlayback, systemImage: desk?.playing == true ? "speaker.wave.2" : "pause.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("sonos-playback-status")
            } else {
                Button {
                    if let playDeskLineIn { playDeskLineIn() }
                    else if let desk {
                        for room in speakers where room.id != desk.id { store.send(.join(room.id, desk.id)) }
                    }
                } label: {
                    Label("Play together", systemImage: "hifispeaker.2")
                        .font(.subheadline.weight(.semibold)).padding(10)
                }
                .buttonStyle(.glass)
                .accessibilityHint("Plays audio from Desk on the other Home speakers")
                .disabled(busy || desk == nil)
            }
        }
        .frame(minHeight: 54)
    }

    private var volumeLock: some View {
        Button {
            store.send(.globalLock)
        } label: {
            Image(systemName: store.globalLock ? "lock.fill" : "lock.open")
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .glassEffect(.regular.interactive(), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Link Home speaker volumes")
        .accessibilityHint("Moving a Home speaker volume adjusts the other Home speakers")
        .accessibilityAddTraits(store.globalLock ? .isSelected : [])
        .accessibilityIdentifier("sonos-volume-lock")
    }

    private func shownVolume(for room: SoundRoom) -> Int {
        if let dragPreview, dragPreview.roomIDs.contains(room.id) {
            return dragPreview.value
        }
        return room.rawVolume
    }

    private func volumeRow(value: Int, title: String, symbol: String, roomID: String? = nil) -> some View {
        let targetIDs: Set<String>
        if let roomID, !store.globalLock || roomID == tv?.id {
            targetIDs = [roomID]
        } else {
            targetIDs = Set(speakers.map(\.id))
        }
        return VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                // Overlay the larger touch target to keep every label row the same height.
                .overlay(alignment: .trailing) {
                    if roomID == nil { volumeLock }
                }
            FilledLevelControl(value: value, label: "\(title) volume", symbol: symbol, showsPercentage: true, preview: { value in
                dragPreview = value.map { VolumePreview(roomIDs: targetIDs, value: $0) }
            }) { value in
                store.send(.roomVolumes(targetIDs, value))
            }
            .frame(height: 58)
            .accessibilityIdentifier("sonos-volume-\(roomID ?? "master")")
        }
    }
}
