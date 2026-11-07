import SwiftUI

struct SonosRoomsPage: View {
    let store: any HomeDataSource
    var playDeskLineIn: (() -> Void)? = nil
    var busy = false

    @State private var masterDrag: MasterDrag?
    @State private var roomPreviews: [String: Int] = [:]

    private struct MasterDrag {
        let balance: SonosVolumeBalance
        let levels: [String: Int]
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

    private var currentBalance: SonosVolumeBalance {
        SonosVolumeBalance(levels: Dictionary(uniqueKeysWithValues: speakers.map { ($0.id, $0.rawVolume) }))
    }

    private var masterVolume: Int {
        SonosVolumeBalance.average(speakers.map { shownVolume(for: $0) })
    }

    private func previewMaster(_ target: Int?) {
        guard let target else { masterDrag = nil; return }
        let balance = masterDrag?.balance ?? currentBalance
        masterDrag = MasterDrag(balance: balance, levels: balance.adjusted(to: target))
    }

    private func commitMaster(_ target: Int) {
        let balance = masterDrag?.balance ?? currentBalance
        if !balance.levels.isEmpty { store.send(.roomVolumes(balance.adjusted(to: target))) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                GlassEffectContainer(spacing: 12) {
                    VStack(spacing: 16) {
                        volumeRow(value: masterVolume, title: "Master", symbol: "hifispeaker.2.fill",
                                  id: "master", preview: previewMaster, commit: commitMaster)
                            .disabled(speakers.isEmpty)
                        Divider()
                        ForEach(speakers) { room in
                            roomRow(room, title: room.name, symbol: "speaker.wave.2.fill")
                        }
                        if let tv {
                            Divider()
                            roomRow(tv, title: "TV", symbol: "tv")
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

    private func shownVolume(for room: SoundRoom) -> Int {
        roomPreviews[room.id] ?? masterDrag?.levels[room.id] ?? room.rawVolume
    }

    private func roomRow(_ room: SoundRoom, title: String, symbol: String) -> some View {
        volumeRow(value: shownVolume(for: room), title: title, symbol: symbol, id: room.id, preview: {
            roomPreviews[room.id] = $0
        }, commit: {
            store.send(.rawVolume(room.id, $0))
        })
    }

    private func volumeRow(value: Int, title: String, symbol: String, id: String,
                           preview: @escaping (Int?) -> Void, commit: @escaping (Int) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
            FilledLevelControl(value: value, label: "\(title) volume", symbol: symbol,
                               showsPercentage: true, preview: preview, commit: commit)
                .frame(height: 58)
                .accessibilityIdentifier("sonos-volume-\(id)")
        }
    }
}

/// A snapshot of the room mix, reused for every preview in a Master gesture.
struct SonosVolumeBalance {
    let levels: [String: Int]

    static func average(_ levels: [Int]) -> Int {
        guard !levels.isEmpty else { return 0 }
        return Int((Double(levels.reduce(0, +)) / Double(levels.count)).rounded())
    }

    func adjusted(to target: Int) -> [String: Int] {
        if target == 0 || target == 100 { return levels.mapValues { _ in target } }
        if target == Self.average(Array(levels.values)) { return levels }

        var remainingVolume = target * levels.count
        var remainingWeight = levels.values.reduce(0, +)
        var remainingRooms = levels.count
        var adjusted: [String: Int] = [:]
        // Reserve 100% for saturated rooms before scaling the quieter ones.
        // When every remaining room started silent, split the remaining volume evenly.
        for (id, weight) in levels.sorted(by: { $0.value > $1.value }) {
            let volume = remainingWeight > 0
                ? Double(weight * remainingVolume) / Double(remainingWeight)
                : Double(remainingVolume) / Double(remainingRooms)
            adjusted[id] = min(100, Int(volume.rounded()))
            if volume >= 100 {
                remainingVolume -= 100
                remainingWeight -= weight
                remainingRooms -= 1
            }
        }
        return adjusted
    }
}
