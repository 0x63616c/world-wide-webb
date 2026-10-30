import SwiftUI

/// Live presentation belongs to Hybrid; the design worker's simulated camera views are untouched.
struct CamerasModule: View {
    let provider: LiveCamerasProvider
    let detail: Bool
    let open: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected: String?

    private var visibleFeeds: [CameraFeed] {
        if let selected { return provider.feeds.filter { $0.id == selected } }
        return detail ? provider.feeds : Array(provider.feeds.prefix(1))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if detail {
                HStack {
                    Text("Cameras").font(.largeTitle.bold())
                    Spacer()
                    if selected != nil {
                        Button("All cameras", systemImage: "arrow.left") { selected = nil }
                            .buttonStyle(.glass).accessibilityIdentifier("cameras-back")
                    }
                }
            }
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24),
                                         count: detail && selected == nil ? 2 : 1), spacing: 24) {
                    ForEach(visibleFeeds) { feed in
                        Button {
                            if detail { selected = feed.id } else { open() }
                        } label: {
                            frame(feed).aspectRatio(4.0 / 3, contentMode: .fit)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open \(feed.name)")
                        .accessibilityValue(provider.updatedAt[feed.id].map {
                            "Updated \($0.formatted(date: .omitted, time: .standard))"
                        } ?? "Snapshot unavailable")
                        .accessibilityIdentifier("camera-\(feed.id)")
                    }
                }
            }
            Text(selected == nil ? "Snapshots · Refresh every 3 seconds" : "Live view · Refresh every second")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(detail ? 48 : 24)
        .task(id: "\(scenePhase == .active)-\(detail)-\(selected ?? "all")-\(visibleFeeds.map(\.id).joined(separator: ","))") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await provider.refreshSnapshots(ids: visibleFeeds.map(\.id))
                do { try await Task.sleep(for: selected == nil ? .seconds(3) : .seconds(1)) }
                catch { return }
            }
        }
        .onChange(of: provider.feeds.map(\.id)) { _, ids in
            if let selected, !ids.contains(selected) { self.selected = nil }
        }
    }

    private func frame(_ feed: CameraFeed) -> some View {
        ZStack(alignment: .bottomLeading) {
            Color.black
            if let image = provider.frames[feed.id] {
                Image(decorative: image, scale: 1).resizable().scaledToFit()
            } else {
                ContentUnavailableView("Snapshot unavailable", systemImage: "video.slash")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(feed.name).font(.title2.bold())
                if let date = provider.updatedAt[feed.id] {
                    Text("Updated \(date.formatted(date: .omitted, time: .standard))").font(.caption.monospacedDigit())
                }
            }
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(.black.opacity(0.65))
        }
        .clipShape(.rect(cornerRadius: 24))
    }
}
