import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveMediaProvider: MediaProvider {
    private(set) var items: [MediaItem] = []
    private(set) var availability: LiveAvailability = .loading
    var videoURL: URL? { items.first.flatMap { streams[$0.id]?.url } }
    @ObservationIgnored private let api: any MediaServing
    @ObservationIgnored private let configuration: PanelKit.PanelConfiguration?
    private var streams: [String: MediaStream] = [:]
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0

    init(api: any MediaServing = MediaAPI(), configuration: PanelKit.PanelConfiguration? = nil) {
        self.api = api; self.configuration = configuration
    }

    func stream(for id: String) -> MediaStream? {
        availability == .live ? streams[id] : nil
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let revision = generation
        defer { refreshing = false }
        do {
            try Task.checkCancellation()
            let videos = try await api.videos()
            try Task.checkCancellation()
            guard revision == generation else { return }
            guard let configuration, !videos.isEmpty else { throw MediaError.sourceUnavailable }
            var next: [String: MediaStream] = [:]
            for video in videos {
                guard !video.id.isEmpty, !video.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      next[video.id] == nil else { throw MediaError.invalidResponse }
                next[video.id] = try MediaStream(url: video.url, configuration: configuration)
            }
            streams = next
            items = videos.map { MediaItem(id: $0.id, title: $0.title, subtitle: $0.subtitle,
                                          kind: .video, trackIndex: 0, tint: "#485c85") }
            availability = .live
        } catch {
            guard revision == generation else { return }
            clear()
        }
    }

    func stop() { generation += 1; clear() }

    private func clear() {
        items = []; streams = [:]
        availability = .unavailable("Media library not connected")
    }
}
