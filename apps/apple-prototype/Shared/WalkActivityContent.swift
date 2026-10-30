import SwiftUI
#if os(iOS)
import ActivityKit

struct WalkActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable { var startedAt: Date }
    var dogName: String
    var walkID: String = "walk_preview"
}
#endif

/// Shared by the widget extension and the explicitly labelled simulator preview.
struct WalkActivityContent: View {
    let name: String
    let startedAt: Date
    var previewElapsed: String? = nil
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "pawprint.fill").font(.system(size: 30)).foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 5) {
                Text("Walking \(name)").font(.headline)
                Text("Walk in progress").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Group {
                if let previewElapsed { Text(previewElapsed) }
                else { Text(startedAt, style: .timer) }
            }.font(.system(size: 30, weight: .medium, design: .rounded)).monospacedDigit()
                .multilineTextAlignment(.trailing).foregroundStyle(.green)
        }.padding(14)
    }
}
