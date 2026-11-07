import ActivityKit
import WidgetKit
import SwiftUI

@main struct WalkWidgetBundle: WidgetBundle {
    var body: some Widget { WalkLiveActivity() }
}
struct WalkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WalkActivityAttributes.self) { context in
            WalkActivityContent(name: context.attributes.dogName, startedAt: context.state.startedAt)
                .widgetURL(URL(string: "www-prototype://dogwalk"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Walking \(context.attributes.dogName)", systemImage: "pawprint.fill").font(.headline).foregroundStyle(.green)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.startedAt, style: .timer).font(.title2.monospacedDigit()).foregroundStyle(.green)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Walk in progress").font(.subheadline).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "pawprint.fill").foregroundStyle(.green)
            } compactTrailing: {
                Text(context.state.startedAt, style: .timer).monospacedDigit().frame(width: 48).foregroundStyle(.green)
            } minimal: {
                Image(systemName: "pawprint.fill").foregroundStyle(.green)
            }
            .widgetURL(URL(string: "www-prototype://dogwalk"))
            .keylineTint(.green)
        }
    }
}
#Preview("Walking Zero", as: .content, using: WalkActivityAttributes(dogName: "Zero")) {
    WalkLiveActivity()
} contentStates: {
    WalkActivityAttributes.ContentState(startedAt: Date().addingTimeInterval(-754))
}
