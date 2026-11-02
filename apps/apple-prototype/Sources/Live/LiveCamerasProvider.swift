import Foundation
import ImageIO
import Observation
import PanelKit

/// Opt-in hybrid provider. MockCamerasProvider and the prototype's views stay unchanged.
@MainActor @Observable final class LiveCamerasProvider: CamerasProvider {
    private(set) var feeds: [CameraFeed] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var frames: [String: CGImage] = [:]
    private(set) var updatedAt: [String: Date] = [:]
    @ObservationIgnored private let api: CamerasAPI
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0

    init(api: CamerasAPI) { self.api = api }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let started = generation
        defer { refreshing = false }
        do {
            let rows = try await api.list()
            guard !Task.isCancelled, started == generation else { return }
            feeds = rows.filter(\.canSnapshot).map { CameraFeed(id: $0.id, name: $0.name, asset: "") }
            let ids = Set(feeds.map(\.id))
            frames = frames.filter { ids.contains($0.key) }
            updatedAt = updatedAt.filter { ids.contains($0.key) }
            availability = feeds.isEmpty ? .unavailable("No cameras configured") : .live
        } catch {
            guard !Task.isCancelled, started == generation else { return }
            feeds = []
            frames = [:]
            updatedAt = [:]
            availability = .unavailable(panelFailureReason(error, fallback: "Cameras are unavailable. Try again later."))
        }
    }

    /// Owned by the visible SwiftUI task, never a detached/background polling timer.
    func refreshSnapshots(ids: [String]) async {
        let started = generation
        for id in ids where feeds.contains(where: { $0.id == id }) {
            do {
                let data = try await api.snapshot(id: id)
                guard !Task.isCancelled, started == generation else { return }
                guard feeds.contains(where: { $0.id == id }) else { continue }
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 2048,
                      ] as CFDictionary) else { throw PanelAPIError.decoding("Invalid camera image.") }
                frames[id] = image
                updatedAt[id] = .now
            } catch {
                guard !Task.isCancelled, started == generation else { return }
                // Never leave an old frame labeled as current after a failure.
                frames[id] = nil
                updatedAt[id] = nil
            }
        }
    }

    func stop() {
        generation += 1
        frames = [:]
        updatedAt = [:]
    }
}
