import Foundation
import Observation
import PanelKit

struct LivePhoto: Identifiable, Hashable, Sendable {
    let id: String
    let collection: String
    let path: String
    let capturedAt: Double
    let groupID: String?
    let filter: String?
}

@MainActor @Observable final class LivePhotosProvider: PhotosProvider {
    private(set) var photos: [PhotoItem] = []
    private(set) var frames: [LivePhoto] = []
    private(set) var sessions: [PhotoSession] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var unlocked = false
    private(set) var error: String?
    private(set) var pending = false
    @ObservationIgnored private let api: PhotosAPI
    @ObservationIgnored private let cache: PhotoCache
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var refreshAgain = false
    @ObservationIgnored private var contentRevision = 0

    init(api: PhotosAPI, cache: PhotoCache) { self.api = api; self.cache = cache }

    func unlock(pin: String) async -> Bool {
        let revision = generation
        do {
            let accepted = try await api.unlock(pin: pin)
            try Task.checkCancellation()
            guard revision == generation else { return false }
            unlocked = accepted
            return accepted
        } catch { return false }
    }

    func lock() { generation += 1; unlocked = false; error = nil }

    func refresh() async {
        guard !refreshing else { refreshAgain = true; return }
        refreshing = true
        repeat {
            refreshAgain = false
            await load()
        } while refreshAgain && !Task.isCancelled
        refreshing = false
    }

    private func load() async {
        let revision = contentRevision
        do {
            async let booth = api.booth()
            async let wakes = api.wakes()
            async let activity = api.sessions()
            let (b, w, s) = try await (booth, wakes, activity)
            try Task.checkCancellation()
            guard revision == contentRevision else { refreshAgain = true; return }
            frames = (b.groups.flatMap { group in
                group.frames.map { frame in
                    LivePhoto(id: "booth:" + frame.id, collection: "booth-photos", path: frame.path,
                              capturedAt: frame.capturedAt, groupID: group.groupId, filter: group.filter)
                }
            } + w.days.flatMap { day in day.photos.map {
                LivePhoto(id: "wake:" + $0.path, collection: "wake-photos", path: $0.path,
                          capturedAt: $0.capturedAt, groupID: nil, filter: nil)
            }}).sorted { $0.capturedAt > $1.capturedAt }
            // Existing protocol remains usable, but live bytes are rendered by Hybrid.
            photos = frames.map { PhotoItem(id: $0.id, asset: $0.path, title: "Photo", credit: "") }
            sessions = s
            availability = .live
        } catch {
            frames = []; photos = []; sessions = []
            availability = .unavailable(panelFailureReason(error, fallback: "Photos are unavailable."))
            lock()
        }
    }

    func image(_ photo: LivePhoto) async throws -> Data {
        guard unlocked, frames.contains(photo) else { throw AccessError.locked }
        let revision = generation
        let key = photo.collection + "/" + photo.path
        if let data = await cache.data(for: key) {
            guard unlocked, revision == generation, frames.contains(photo) else { throw AccessError.locked }
            return data
        }
        let data = try await api.image(collection: photo.collection, path: photo.path)
        guard unlocked, revision == generation, frames.contains(photo) else { throw AccessError.locked }
        await cache.insert(data, for: key)
        guard unlocked, revision == generation, frames.contains(photo) else { throw AccessError.locked }
        return data
    }

    func remove(_ photo: LivePhoto) async { await mutate(photo, clear: false) }
    func clearFilter(_ photo: LivePhoto) async { await mutate(photo, clear: true) }

    private func mutate(_ photo: LivePhoto, clear: Bool) async {
        guard unlocked, !pending, let group = photo.groupID,
              frames.contains(where: { $0.id == photo.id && $0.groupID == group }) else { return }
        pending = true; error = nil
        defer { pending = false }
        do {
            if clear { try await api.clearFilter(groupID: group) }
            else { try await api.remove(groupID: group) }
            contentRevision += 1
            if clear {
                frames = frames.map {
                    guard $0.groupID == group else { return $0 }
                    return LivePhoto(id: $0.id, collection: $0.collection, path: $0.path,
                                     capturedAt: $0.capturedAt, groupID: group, filter: nil)
                }
            } else {
                frames.removeAll { $0.groupID == group }
                photos = frames.map { PhotoItem(id: $0.id, asset: $0.path, title: "Photo", credit: "") }
                await cache.clear()
            }
            await refresh()
        } catch { self.error = "Could not update this capture. Try again." }
    }
    private enum AccessError: Error { case locked }
}
