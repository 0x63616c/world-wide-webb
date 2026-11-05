import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveSpotifyProvider {
    private let api: SpotifyAPI
    private(set) var state: SpotifyState?
    private(set) var library: SpotifyLibrary?
    private(set) var error: String?
    private(set) var libraryError: String?
    private(set) var notice: String?
    private(set) var browsing = false
    private(set) var pending = false
    private(set) var roomID: String?
    private(set) var sourceID: String?
    private(set) var path: [SpotifyItem] = []
    private var optimistic: (room: String, playing: Bool, expires: Date)?
    @ObservationIgnored private var browseTask: Task<Void, Never>?
    @ObservationIgnored private var browseGeneration = 0
    @ObservationIgnored private var commandTask: Task<Void, Never>?

    init(api: SpotifyAPI) { self.api = api }
    var room: SpotifyRoom? { state?.rooms.first { $0.id == roomID } }
    var playing: Bool {
        if let optimistic, optimistic.room == roomID, optimistic.expires > .now { return optimistic.playing }
        return room?.playing ?? false
    }
    func run() async {
        await refresh()
        browse()
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(3)) } catch { break }
            await refresh()
        }
    }
    func refresh() async {
        do {
            let response = try await api.state()
            try Task.checkCancellation()
            state = response; error = nil
            if !response.rooms.contains(where: { $0.id == roomID }) {
                roomID = response.rooms.first(where: \.available)?.id ?? response.rooms.first?.id
            }
            if sourceID == nil { sourceID = response.accounts.first?.id ?? roomID }
            if let optimistic, let room, room.id == optimistic.room,
               room.playing == optimistic.playing || optimistic.expires <= .now { self.optimistic = nil }
        } catch {
            guard !Task.isCancelled else { return }
            self.error = "Couldn’t connect to music. Check Home Assistant and try again."
        }
    }
    func selectRoom(_ id: String) { roomID = id; notice = nil }
    func selectSource(_ id: String) { sourceID = id; path = []; browse() }
    func open(_ item: SpotifyItem) { path.append(item); browse() }
    func back() { guard !path.isEmpty else { return }; path.removeLast(); browse() }
    func browse() {
        browseTask?.cancel(); browseGeneration += 1
        guard let sourceID else { return }
        let reference = path.last?.reference
        let generation = browseGeneration
        browsing = true; libraryError = nil
        browseTask = Task {
            do {
                let response = try await api.browse(source: sourceID, reference: reference)
                try Task.checkCancellation()
                guard generation == browseGeneration else { return }
                library = response; browsing = false
            } catch {
                guard !Task.isCancelled, generation == browseGeneration else { return }
                library = nil; browsing = false
                libraryError = "This library couldn’t open. Connect Spotify in Home Assistant, or play a Spotify link below."
            }
        }
    }
    func stopBrowsing() { browseTask?.cancel(); browseGeneration += 1; browsing = false }
    func play(_ reference: SpotifyReference) {
        guard let room, room.available, !pending else { return }
        perform(room: room.id, playing: true) { try await self.api.play(room: room.id, reference: reference) }
    }
    func transport(_ command: String) {
        guard let room, room.available, !pending else { return }
        perform(room: room.id, playing: command == "play" ? true : command == "pause" ? false : nil) {
            try await self.api.transport(room: room.id, command: command)
        }
    }
    private func perform(room: String, playing: Bool?, action: @escaping @MainActor () async throws -> Void) {
        pending = true; error = nil; notice = nil
        if let playing { optimistic = (room, playing, .now.addingTimeInterval(10)) }
        // A submitted write completes even if the page closes; never retry it automatically.
        commandTask = Task {
            defer { pending = false; commandTask = nil }
            do {
                try await action()
                notice = "Sent to \(state?.rooms.first { $0.id == room }?.name ?? "your room")"
                await refresh()
            } catch {
                optimistic = nil
                self.error = "Playback couldn’t change. Check that Spotify is linked in Sonos, then try again."
            }
        }
    }
}
